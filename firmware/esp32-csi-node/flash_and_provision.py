#!/usr/bin/env python3
"""
ESP32-S3 CSI Node — Flash & Provision Script

Flashes firmware and provisions WiFi + network config for two ESP32-S3 nodes
connected to a Raspberry Pi.

Usage:
    python3 flash_and_provision.py --ssid "MyWiFi" --password "MyPassword"
    python3 flash_and_provision.py --ssid "MyWiFi" --password "MyPassword" --target-ip 192.168.1.50
    python3 flash_and_provision.py --ssid "MyWiFi" --password "MyPassword" --skip-flash
"""

import argparse
import glob
import os
import shutil
import socket
import subprocess
import sys


ESPTOOL_SEARCH_PATHS = [
    os.path.expanduser("~/esptool"),
    os.path.expanduser("~/.local/bin"),
    "/usr/local/bin",
]


def find_esptool():
    """Find the esptool executable or module."""
    # 1. Try as a Python module
    try:
        subprocess.run(
            [sys.executable, "-m", "esptool", "version"],
            capture_output=True, timeout=5,
        )
        return [sys.executable, "-m", "esptool"]
    except Exception:
        pass

    # 2. Try esptool.py on PATH
    esptool_path = shutil.which("esptool.py") or shutil.which("esptool")
    if esptool_path:
        return [esptool_path]

    # 3. Search common directories
    for search_dir in ESPTOOL_SEARCH_PATHS:
        for name in ("esptool.py", "esptool"):
            candidate = os.path.join(search_dir, name)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return [candidate]
            if os.path.isfile(candidate):
                return [sys.executable, candidate]

    # 4. Search home directory recursively (shallow)
    home = os.path.expanduser("~")
    for dirpath, dirnames, filenames in os.walk(home):
        # Don't recurse too deep
        depth = dirpath.replace(home, "").count(os.sep)
        if depth > 3:
            dirnames.clear()
            continue
        if "esptool.py" in filenames:
            candidate = os.path.join(dirpath, "esptool.py")
            return [sys.executable, candidate]
        if "esptool" in filenames:
            candidate = os.path.join(dirpath, "esptool")
            if os.access(candidate, os.X_OK):
                return [candidate]

    return None


def get_local_ip():
    """Get the Pi's local IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def find_esp32_ports():
    """Find connected ESP32-S3 serial ports."""
    patterns = ["/dev/ttyACM*", "/dev/ttyUSB*"]
    ports = []
    for pattern in patterns:
        ports.extend(sorted(glob.glob(pattern)))
    return ports


def run_cmd(cmd, description):
    """Run a shell command, printing status."""
    print(f"\n{'='*60}")
    print(f"  {description}")
    print(f"{'='*60}")
    print(f"  $ {' '.join(cmd)}\n")
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        print(f"\nERROR: {description} failed (exit code {result.returncode})")
        return False
    return True


def flash_node(port, build_dir, baud, esptool_cmd):
    """Flash firmware to an ESP32-S3 via esptool."""
    bootloader = os.path.join(build_dir, "bootloader", "bootloader.bin")
    partition_table = os.path.join(build_dir, "partition_table", "partition-table.bin")
    app_bin = os.path.join(build_dir, "esp32-csi-node.bin")

    for f in (bootloader, partition_table, app_bin):
        if not os.path.isfile(f):
            print(f"ERROR: Build artifact not found: {f}")
            print("Run the Docker build first (Step 3).")
            return False

    return run_cmd(esptool_cmd + [
        "--chip", "esp32s3",
        "--port", port,
        "--baud", str(baud),
        "write_flash", "--flash_mode", "dio", "--flash_size", "8MB",
        "0x0", bootloader,
        "0x8000", partition_table,
        "0x10000", app_bin,
    ], f"Flashing firmware to {port}")


def provision_node(port, provision_script, ssid, password, target_ip,
                   target_port, node_id, tdm_slot, tdm_total, edge_tier, baud):
    """Provision WiFi and network config via NVS."""
    cmd = [
        sys.executable, provision_script,
        "--port", port,
        "--baud", str(baud),
        "--ssid", ssid,
        "--password", password,
        "--target-ip", target_ip,
        "--target-port", str(target_port),
        "--node-id", str(node_id),
        "--tdm-slot", str(tdm_slot),
        "--tdm-total", str(tdm_total),
        "--edge-tier", str(edge_tier),
    ]
    return run_cmd(cmd, f"Provisioning Node {node_id} on {port}")


def main():
    parser = argparse.ArgumentParser(
        description="Flash and provision two ESP32-S3 CSI nodes",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Example:\n  python3 flash_and_provision.py --ssid MyWiFi --password secret123",
    )
    parser.add_argument("--ssid", required=True, help="WiFi SSID (2.4 GHz)")
    parser.add_argument("--password", required=True, help="WiFi password")
    parser.add_argument("--target-ip", default=None,
                        help="Aggregator IP (default: auto-detect Pi's IP)")
    parser.add_argument("--target-port", type=int, default=5005,
                        help="Aggregator UDP port (default: 5005)")
    parser.add_argument("--edge-tier", type=int, default=2, choices=[0, 1, 2],
                        help="Edge processing tier: 0=raw, 1=basic, 2=full (default: 2)")
    parser.add_argument("--baud", type=int, default=460800,
                        help="Flash baud rate (default: 460800)")
    parser.add_argument("--port1", default=None,
                        help="Serial port for Node 1 (default: auto-detect)")
    parser.add_argument("--port2", default=None,
                        help="Serial port for Node 2 (default: auto-detect)")
    parser.add_argument("--skip-flash", action="store_true",
                        help="Skip flashing, only provision WiFi config")
    parser.add_argument("--single", action="store_true",
                        help="Only one ESP32 connected (no TDM)")
    args = parser.parse_args()

    # Resolve script directory (where build/ and provision.py live)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    build_dir = os.path.join(script_dir, "build")
    provision_script = os.path.join(script_dir, "provision.py")

    if not os.path.isfile(provision_script):
        print(f"ERROR: provision.py not found at {provision_script}")
        sys.exit(1)

    # Find esptool
    esptool_cmd = None
    if not args.skip_flash:
        esptool_cmd = find_esptool()
        if esptool_cmd is None:
            print("ERROR: esptool not found.")
            print("Install it:  pip install esptool")
            print("Or specify its location in ESPTOOL_SEARCH_PATHS in this script.")
            sys.exit(1)
        print(f"Using esptool: {' '.join(esptool_cmd)}")

    # Auto-detect target IP
    target_ip = args.target_ip
    if target_ip is None:
        target_ip = get_local_ip()
        if target_ip is None:
            print("ERROR: Could not auto-detect IP. Use --target-ip to specify.")
            sys.exit(1)
    print(f"Aggregator target: {target_ip}:{args.target_port}")

    # Find serial ports
    if args.port1 and args.port2:
        ports = [args.port1, args.port2]
    elif args.port1 and args.single:
        ports = [args.port1]
    else:
        ports = find_esp32_ports()
        if len(ports) == 0:
            print("ERROR: No ESP32 serial ports found.")
            print("Check that boards are plugged in: ls /dev/ttyACM* /dev/ttyUSB*")
            sys.exit(1)

    if args.single:
        ports = ports[:1]
        num_nodes = 1
    else:
        if len(ports) < 2:
            print(f"WARNING: Expected 2 ESP32 boards but found {len(ports)}: {ports}")
            print("Use --single if you only have one board, or --port1/--port2 to specify.")
            if len(ports) == 1:
                print(f"Continuing with single node on {ports[0]}")
                num_nodes = 1
            else:
                sys.exit(1)
        else:
            ports = ports[:2]
            num_nodes = 2

    print(f"Detected {num_nodes} node(s): {', '.join(ports)}")
    print(f"WiFi SSID: {args.ssid}")
    print(f"Edge tier: {args.edge_tier}")
    print()

    tdm_total = num_nodes if num_nodes > 1 else 1

    # Process each node
    for i, port in enumerate(ports):
        node_id = i + 1
        tdm_slot = i

        print(f"\n{'#'*60}")
        print(f"#  NODE {node_id} — {port}")
        print(f"{'#'*60}")

        # Flash
        if not args.skip_flash:
            if not flash_node(port, build_dir, args.baud, esptool_cmd):
                print(f"\nFlash failed for Node {node_id}. Aborting.")
                print("Tip: Hold the BOOT button on the ESP32 while this runs.")
                sys.exit(1)

        # Provision
        if not provision_node(
            port, provision_script, args.ssid, args.password,
            target_ip, args.target_port, node_id, tdm_slot,
            tdm_total, args.edge_tier, args.baud,
        ):
            print(f"\nProvisioning failed for Node {node_id}. Aborting.")
            sys.exit(1)

    # Summary
    print(f"\n{'='*60}")
    print(f"  ALL DONE — {num_nodes} node(s) flashed and provisioned")
    print(f"{'='*60}")
    print()
    print(f"  WiFi SSID:      {args.ssid}")
    print(f"  Aggregator:     {target_ip}:{args.target_port}")
    print(f"  Edge tier:      {args.edge_tier}")
    print(f"  TDM nodes:      {tdm_total}")
    print()
    for i, port in enumerate(ports):
        print(f"  Node {i+1}: {port}  (tdm_slot={i})")
    print()
    print("Next steps:")
    print(f"  1. Verify:  python3 -m serial.tools.miniterm {ports[0]} 115200")
    print(f"  2. Server:  cargo run -p wifi-densepose-sensing-server -- --http-port 3000 --source auto")
    print(f"  3. Browse:  http://{target_ip}:3000")
    print()


if __name__ == "__main__":
    main()
