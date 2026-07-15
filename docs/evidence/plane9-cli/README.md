# Plane9 CLI diagnostic evidence

Direct evidence of Plane9 command-line behavior on this workstation.
Every test times out at the interval shown; every stdout/stderr file is
zero bytes; every exit code is 124 (timeout). Plane9's binary opens a Qt
event loop on start regardless of the switches passed, and neither
stdout nor stderr is written before the timeout fires.

Environment: Windows 11, Plane9 v2.5.1.3 at `C:\Program Files (x86)\Plane9\`
(same install the DLL string dump was extracted from — see
`fixtures/plane9/engine-dll-strings.txt`, DLL section `597:-------- Starting v2.5.1.3 --------`).

## Tests

| # | Command | Timeout | Exit | stdout | stderr | Process observed |
|---|---------|---------|------|--------|--------|------------------|
| 1 | `Plane9.exe` (no args) | 6 s | 124 | 0 B | 0 B | Plane9 process running under Qt event loop |
| 2 | `Plane9.exe -h` | 6 s | 124 | 0 B | 0 B | Modal "Plane9 command line help" window (Qt dialog); no stdout output |
| 3 | `Plane9.exe -windowed -w 320 -h 240 -filename <scene>` | 6 s | 124 | 0 B | 0 B | Qt window loading scene |
| 4 | `Plane9.exe -movie -w 320 -h 240 -recordfps 30 -recordtime 3 -filename <scene> -moviefile <mp4> -song <mp3>` | 15 s | 124 | 0 B | 0 B | Process runs beyond `-recordtime`; produces no output before timeout |

## What this shows

- Plane9 does not log to stdout or stderr on any switch.
- The `-h` switch surfaces its help through a modal GUI window, not a
  printed message the shell can capture.
- The `-movie` mode with `-recordtime 3` does not exit within 15 seconds
  (five times the requested record duration); the process must be
  externally killed.
- None of the invocation forms produce output the harness can parse.

## Consequence for reference captures

Deterministic native-capture invocation of Plane9 on this workstation
requires either:

1. A GUI-attended run of Plane9 Studio (`Plane9.Studio.exe`) whose
   playlist tab lets a human trigger movie encoding while a screen
   recorder captures the output.
2. A hooked-invocation form Plane9 supports that has not surfaced in
   the DLL string table `ParseCommandLine` section — the strings dumped
   at line 611 name the recognized switches, and switches beyond that
   set are not recognized.

Both paths require interactive access to a workstation with a display.
The diagnostic evidence above is the direct witness for that
requirement; the CLI failure is not a summary claim.

## Files

- `no-args.txt`, `no-args.stdout`, `no-args.stderr` — Test 1
- `help.txt`, `help.stdout`, `help.stderr` — Test 2
- `windowed.txt`, `windowed.stdout`, `windowed.stderr` — Test 3
- `movie.txt`, `movie.stdout`, `movie.stderr` — Test 4
