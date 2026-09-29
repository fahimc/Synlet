import { spawn, execFile } from "node:child_process";
import { resolve } from "node:path";
import { DomainError, type Json } from "@synlet/core";

/** No command classification or allowlist. Every command is chosen by the LLM/operator. */
export async function runHostCommand(
  args: Record<string, Json>,
  defaultCwd: string,
  signal?: AbortSignal,
): Promise<Json> {
  signal?.throwIfAborted();
  if (typeof args.command !== "string" || !args.command.trim())
    throw new DomainError(
      "INVALID_OUTPUT",
      "command must be a nonempty string",
    );
  const cwd = typeof args.cwd === "string" ? resolve(args.cwd) : defaultCwd;
  const shell =
    process.platform === "win32"
      ? args.shell === "cmd"
        ? "cmd"
        : "powershell"
      : "posix";
  const executable =
    shell === "cmd"
      ? (process.env.ComSpec ?? "cmd.exe")
      : shell === "powershell"
        ? "powershell.exe"
        : "/bin/sh";
  const commandArgs =
    shell === "cmd"
      ? ["/d", "/s", "/c", args.command]
      : shell === "powershell"
        ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", args.command]
        : ["-lc", args.command];
  const requested =
    typeof args.timeoutMs === "number" ? args.timeoutMs : 120000;
  if (!Number.isFinite(requested) || requested <= 0)
    throw new DomainError("INVALID_OUTPUT", "timeoutMs must be positive");
  const timeoutMs = Math.min(requested, 24 * 60 * 60 * 1000);
  return new Promise<Json>((resolveResult, reject) => {
    const child = spawn(executable, commandArgs, {
      cwd,
      env: process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    let stopped = false,
      timedOut = false,
      outputTruncated = false;
    let stopFailure: string | undefined;
    const capture = (current: string, next: string) => {
      const merged = current + next;
      if (merged.length > 1024 * 1024) {
        outputTruncated = true;
        return merged.slice(0, 1024 * 1024);
      }
      return merged;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = capture(stderr, chunk);
    });
    const stop = () => {
      if (stopped || child.exitCode !== null) return;
      stopped = true;
      if (!child.pid) return;
      if (process.platform === "win32") {
        execFile(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, timeout: 10000 },
          (error) => {
            if (error && child.exitCode === null) {
              stopFailure = error.message;
              child.kill("SIGKILL");
            }
          },
        );
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            stopFailure = String(error);
          child.kill("SIGKILL");
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    };
    child.once("error", (error) => {
      cleanup();
      reject(
        new DomainError(
          "CAPABILITY_UNAVAILABLE",
          `Shell could not start: ${error.message}`,
        ),
      );
    });
    child.once("close", (code, terminationSignal) => {
      cleanup();
      // Non-empty stderr is NOT failure: many valid commands use stderr for warnings/progress.
      resolveResult({
        ok: code === 0 && !stopped,
        command: args.command!,
        cwd,
        platform: process.platform,
        shell,
        exitCode: code ?? -1,
        terminationSignal,
        stdout,
        stderr,
        outputTruncated,
        ...(outputTruncated
          ? {
              outputNotice:
                "Output capture reached 1 MiB per stream. Use shell redirection to a file and read chunks for complete large output.",
            }
          : {}),
        ...(stopped
          ? {
              outcomeUnknown: true,
              timedOut,
              cancelled: signal?.aborted ?? false,
              message:
                "Process-tree termination requested and shell exit observed; external service/network effects require reconciliation",
              ...(stopFailure ? { stopFailure } : {}),
            }
          : {}),
      });
    });
    if (signal?.aborted) stop();
  });
}
