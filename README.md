# r2-benchmark

Benchmarking tool for Cloudflare's R2 storage system. Assess the maximum number of operations per second (ops/s) for various operations like write, read, remove, and stat, either on a single bucket or spanning multiple buckets.

## Background

Cloudflare R2 storage has certain performance limits. As per a discussion with a Cloudflare R2 engineer:
- Expected writes per second: ~3000 ops/s
- Expected reads per second: ~20000 ops/s

My benchmarks yielded the following results over 3 different buckets, executed from different hosts:
- **Write**: 5439 ops/s
- **Read**: 3111 ops/s
- **Stat**: 2409 ops/s
- **Remove**: 2798 ops/s

## Installation

```bash
npm install
```

## Configuration

Begin by creating a `.env` file using the template provided in `.env.example`:

```plaintext
# Specify one or more buckets, separated by a comma.
# More buckets can theoretically provide higher performance if we approach the I/O limits of a single bucket.
S3_BUCKET=bucket1,bucket2,bucket3
S3_HOSTNAME=XXX.r2.cloudflarestorage.com
S3_ACCESS_KEY=some_access_key
S3_SECRET_KEY=some_secret_key
```

## Usage

Run the benchmark using:

```bash
node r2-benchmark.js <number of objects> <number of threads>
```

- **Number of objects**: Total objects the program will write to the bucket.
- **Number of threads**: Threads that will use separate keep-alive TCP connections from an HTTP agent. A high number of threads are necessary for sustaining top throughput.

The benchmark will execute in stages:
1. **Writing**: The program writes the specified number of objects using the provided threads.
2. **Reading**: Validates the contents of each stored object by reading and measuring read performance.
3. **Stat**: Measures the stat performance.
4. **Removal**: Cleans up all objects that were written and measures removal performance.

### Example:

```bash
> node r2-benchmark.js 10000 1000
```

Output:

```plaintext
> node r2-benchmark.js 10000 1000
Write: scheduling for 10000 objects in 1000 threads and 1 buckets
03:10:02: Write: Ops 0.0/s Throughput 0.0MB/s
03:10:03: Write: Ops 0.0/s Throughput 0.0MB/s
03:10:04: Write: Ops 642.2/s Throughput 10.0MB/s
03:10:05: Write: Ops 931.1/s Throughput 14.5MB/s
03:10:06: Write: Ops 1162.0/s Throughput 18.2MB/s
Retrying on TRANSIENT error
Retrying on TRANSIENT error
03:10:07: Write: Ops 1213.3/s Throughput 19.0MB/s
Retrying on TRANSIENT error
03:10:08: Write: Ops 1127.9/s Throughput 17.6MB/s
Retrying on TRANSIENT error
03:10:09: Write: Ops 1284.2/s Throughput 20.1MB/s
03:10:10: Write: Ops 1251.9/s Throughput 19.6MB/s
Retrying on TRANSIENT error
Retrying on TRANSIENT error
03:10:11: Write: Ops 1183.1/s Throughput 18.5MB/s
Retrying on TRANSIENT error
Retrying on TRANSIENT error
03:10:12: Write: Ops 867.6/s Throughput 13.6MB/s
Retrying on TRANSIENT error
03:10:13: Write: Ops 23.0/s Throughput 0.4MB/s
Write took 13477ms. Peak ops 1284.2/s Avg ops 742.0/s  Total size 156.3MB  Recoverable errors 9
Read: scheduling for 10000 objects in 1000 threads and 1 buckets
03:10:15: Read: Ops 0.0/s Throughput 0.0MB/s
03:10:16: Read: Ops 741.6/s Throughput 11.6MB/s
03:10:18: Read: Ops 1109.1/s Throughput 17.3MB/s
03:10:19: Read: Ops 1346.1/s Throughput 21.0MB/s
03:10:20: Read: Ops 1435.3/s Throughput 22.4MB/s
Retrying on TRANSIENT error
03:10:22: Read: Ops 1429.4/s Throughput 22.3MB/s
03:10:23: Read: Ops 2057.7/s Throughput 32.2MB/s
Read took 8985ms. Peak ops 2057.7/s Avg ops 1113.0/s  Total size 156.3MB  Recoverable errors 1
Stat: scheduling for 10000 objects in 1000 threads and 1 buckets
03:10:24: Stat: Ops 0.0/s Throughput 0.0MB/s
03:10:25: Stat: Ops 1108.4/s Throughput 17.3MB/s
03:10:26: Stat: Ops 1575.2/s Throughput 24.6MB/s
03:10:28: Stat: Ops 1625.4/s Throughput 25.4MB/s
03:10:29: Stat: Ops 1634.1/s Throughput 25.5MB/s
Retrying on TRANSIENT error
03:10:30: Stat: Ops 2418.3/s Throughput 37.8MB/s
Stat took 7916ms. Peak ops 2418.3/s Avg ops 1263.3/s  Total size 156.3MB  Recoverable errors 1
Remove: scheduling for 10000 objects in 1000 threads and 1 buckets
03:10:32: Remove: Ops 0.0/s Throughput 0.0MB/s
03:10:33: Remove: Ops 847.1/s Throughput 13.2MB/s
03:10:34: Remove: Ops 1570.5/s Throughput 24.5MB/s
03:10:35: Remove: Ops 1614.0/s Throughput 25.2MB/s
Retrying on TRANSIENT error
Retrying on TRANSIENT error
03:10:36: Remove: Ops 1599.6/s Throughput 25.0MB/s
Retrying on TRANSIENT error
03:10:37: Remove: Ops 1648.8/s Throughput 25.8MB/s
Retrying on TRANSIENT error
Retrying on TRANSIENT error
Retrying on TRANSIENT error
Retrying on TRANSIENT error
Retrying on TRANSIENT error
Retrying on TRANSIENT error
03:10:38: Remove: Ops 1749.2/s Throughput 27.3MB/s
Retrying on TRANSIENT error
03:10:39: Remove: Ops 485.0/s Throughput 7.6MB/s
03:10:40: Remove: Ops 14.0/s Throughput 0.2MB/s
Retrying on TRANSIENT error
Retrying on TRANSIENT error
03:10:41: Remove: Ops 2.0/s Throughput 0.0MB/s
Remove took 11403ms. Peak ops 1749.2/s Avg ops 877.0/s  Total size 156.3MB  Recoverable errors 12
```

From this execution, we observed:
- Peak **Write** ops/s: 1284
- Peak **Read** ops/s: 2057
- Peak **Stat** ops/s: 2418
- Peak **Remove** ops/s: 1749

## Running on Multiple Hosts

To fully evaluate the maximum operations per second (ops/s) achievable, it's advantageous to run this script across several Node processes and on different machines.

### Setup

1. Install and configure this repository on multiple SSH hosts.
2. Ensure you have a terminal feature, like the one in Konsole, that can simultaneously run commands across multiple terminals.

### Execution

On each host, run:

```bash
node r2-benchmark.js 10000 1000 | tee log-$HOST.txt
```

This command will execute the benchmark and save the logs with the hostname as a part of the filename.

After collecting data from all hosts, gather all log files in a single location and analyze the peak performance:

```bash
node peak-performance.js log*.txt
```

Output:

```plaintext
Peak Performance: {
  Write: 5439.7,
  Read: 3111.2000000000003,
  Stat: 2409.5,
  Remove: 2798.0000000000005
}
```

## License

Copyright (c) 2023, Code Charm, Inc.

License: MIT
