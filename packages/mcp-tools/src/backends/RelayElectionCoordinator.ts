import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const logger = {
  info: (...args: any[]) => console.error("[RelayElection]", ...args),
  warn: (...args: any[]) => console.error("[RelayElection]", ...args),
  error: (...args: any[]) => console.error("[RelayElection]", ...args),
};

export interface RelayLease {
  pid: number;
  heartbeat: number; // Date.now()
  startedAt: string; // ISO
  port: number;
}

export type RelayRole = "master" | "follower" | "stopped";

export interface RelayElectionCoordinatorOptions {
  port: number;
  onPromoted: () => Promise<void>;
  onDemoted: () => Promise<void>;
}

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_STALE_MS = 6000;
const FOLLOWER_POLL_INTERVAL_MS = 3000;
const PROMOTION_SETTLE_MS = 500;

export class RelayElectionCoordinator {
  private port: number;
  private role: RelayRole = "stopped";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onPromoted: () => Promise<void>;
  private onDemoted: () => Promise<void>;
  private exitHandler: (() => void) | null = null;
  private sigTermHandler: (() => void) | null = null;
  private sigIntHandler: (() => void) | null = null;
  private leaseDir: string | null = null;

  constructor(options: RelayElectionCoordinatorOptions) {
    this.port = options.port;
    this.onPromoted = options.onPromoted;
    this.onDemoted = options.onDemoted;
  }

  private getLeasePath(): string {
    if (!this.leaseDir) {
      this.leaseDir = path.join(os.homedir(), ".shiplight");
      fs.mkdirSync(this.leaseDir, { recursive: true });
    }
    return path.join(this.leaseDir, `relay-${this.port}.lease`);
  }

  private readLease(): RelayLease | null {
    try {
      const content = fs.readFileSync(this.getLeasePath(), "utf-8");
      return JSON.parse(content) as RelayLease;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private isLeaseAlive(lease: RelayLease): boolean {
    if (!this.isProcessAlive(lease.pid)) return false;
    if (Date.now() - lease.heartbeat > HEARTBEAT_STALE_MS) return false;
    return true;
  }

  private acquireLease(): boolean {
    const leasePath = this.getLeasePath();
    const tmpPath = leasePath + ".tmp";

    // Check existing lease
    const existing = this.readLease();
    if (existing && this.isLeaseAlive(existing)) {
      return false;
    }

    // Write new lease atomically
    const lease: RelayLease = {
      pid: process.pid,
      heartbeat: Date.now(),
      startedAt: new Date().toISOString(),
      port: this.port,
    };

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(lease), "utf-8");
      fs.renameSync(tmpPath, leasePath);
    } catch (err) {
      logger.error("Failed to write lease file:", err);
      return false;
    }

    // Verify we won
    const verified = this.readLease();
    return verified?.pid === process.pid;
  }

  private writeHeartbeat(): void {
    const leasePath = this.getLeasePath();
    try {
      const lease = this.readLease();
      if (!lease || lease.pid !== process.pid) {
        // We lost the lease (shouldn't happen but handle gracefully)
        logger.warn("Lost lease ownership, demoting");
        this.demote().catch(err => logger.error("Demotion failed:", err));
        return;
      }
      lease.heartbeat = Date.now();
      fs.writeFileSync(leasePath, JSON.stringify(lease), "utf-8");
    } catch (err) {
      logger.error("Failed to write heartbeat:", err);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => this.writeHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
    // Write first heartbeat immediately
    this.writeHeartbeat();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private releaseLease(): void {
    this.stopHeartbeat();
    try {
      const lease = this.readLease();
      if (lease?.pid === process.pid) {
        fs.unlinkSync(this.getLeasePath());
      }
    } catch {
      // Best effort cleanup
    }
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => this.pollForPromotion(), FOLLOWER_POLL_INTERVAL_MS);
    this.pollTimer.unref();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollForPromotion(): Promise<void> {
    const lease = this.readLease();

    const shouldPromote =
      !lease || // No lease file
      !this.isProcessAlive(lease.pid) || // Master PID dead
      Date.now() - lease.heartbeat > HEARTBEAT_STALE_MS; // Heartbeat stale

    if (!shouldPromote) return;

    logger.info(
      lease
        ? `Master (PID ${lease.pid}) appears dead, attempting promotion`
        : "No lease file found, attempting promotion"
    );

    await this.attemptPromotion();
  }

  private async attemptPromotion(): Promise<boolean> {
    if (!this.acquireLease()) {
      logger.info("Another instance acquired the lease first");
      return false;
    }

    // Small settle time to avoid racing with other promotions
    await new Promise((resolve) => setTimeout(resolve, PROMOTION_SETTLE_MS));

    // Verify we still hold the lease after settling
    const lease = this.readLease();
    if (!lease || lease.pid !== process.pid) {
      logger.info("Lost lease during settle period");
      return false;
    }

    try {
      this.stopPolling();
      this.role = "master";
      this.startHeartbeat();
      await this.onPromoted();
      logger.info(`Promoted to master (PID ${process.pid})`);
      return true;
    } catch (err: any) {
      // Promotion failed (likely EADDRINUSE)
      logger.warn(`Promotion failed: ${err.message}`);
      this.releaseLease();
      this.role = "follower";
      this.startPolling();
      return false;
    }
  }

  private async demote(): Promise<void> {
    this.stopHeartbeat();
    this.role = "follower";
    await this.onDemoted();
    this.startPolling();
  }

  private registerExitHandlers(): void {
    this.exitHandler = () => {
      if (this.role === "master") {
        this.releaseLease();
      }
    };
    this.sigTermHandler = () => {
      this.exitHandler?.();
      process.exit(0);
    };
    this.sigIntHandler = () => {
      this.exitHandler?.();
      process.exit(0);
    };
    process.on("exit", this.exitHandler);
    process.on("SIGTERM", this.sigTermHandler);
    process.on("SIGINT", this.sigIntHandler);
  }

  private removeExitHandlers(): void {
    if (this.exitHandler) process.off("exit", this.exitHandler);
    if (this.sigTermHandler) process.off("SIGTERM", this.sigTermHandler);
    if (this.sigIntHandler) process.off("SIGINT", this.sigIntHandler);
    this.exitHandler = null;
    this.sigTermHandler = null;
    this.sigIntHandler = null;
  }

  async start(): Promise<RelayRole> {
    this.registerExitHandlers();

    // Try to become master
    if (this.acquireLease()) {
      this.role = "master";
      this.startHeartbeat();
      try {
        await this.onPromoted();
        logger.info(`Elected as master (PID ${process.pid}) on port ${this.port}`);
        return "master";
      } catch (err: any) {
        // Port bind failed — another process holds it despite stale lease
        logger.warn(`Failed to start as master: ${err.message}`);
        this.releaseLease();
        this.role = "follower";
        this.startPolling();
        logger.info(`Running as follower, master on port ${this.port}`);
        return "follower";
      }
    }

    // Become follower
    this.role = "follower";
    this.startPolling();
    logger.info(`Running as follower (PID ${process.pid}), master on port ${this.port}`);
    return "follower";
  }

  async stop(): Promise<void> {
    this.stopPolling();
    if (this.role === "master") {
      this.releaseLease();
    }
    this.removeExitHandlers();
    this.role = "stopped";
  }

  getRole(): RelayRole {
    return this.role;
  }

  getCdpUrl(): string {
    return `ws://127.0.0.1:${this.port}/cdp`;
  }
}
