/**
 * Interactive CLI for Mobile Agents
 *
 * Supports both VisionAgent (pure vision) and TextVisionAgent (text+vision).
 * Features:
 * - Auto-start Android emulator if needed
 * - Auto-start Appium server if needed (for TextVisionAgent)
 * - Touch visualization toggle
 * - Interactive command handling
 *
 * Environment Variables:
 * - AGENT_TYPE: vision | text-vision (default: text-vision)
 * - AI_PROVIDER: openai | gemini (default: gemini)
 * - GEMINI_API_KEY: Required for Gemini provider
 * - GOOGLE_API_KEY: Alternative for Gemini provider
 * - OPENAI_API_KEY: Required for OpenAI provider
 * - ANDROID_DEVICE: Android device ID (default: auto-detect)
 * - APPIUM_HOST: Appium server host (default: localhost)
 * - APPIUM_PORT: Appium server port (default: 4723)
 * - DEBUG_DIR: Directory for logs and screenshots (default: ./logs)
 *
 * Usage:
 * # TextVisionAgent (default)
 * pnpm tsx scripts/test-agent.ts
 *
 * # VisionAgent
 * AGENT_TYPE=vision pnpm tsx scripts/test-agent.ts
 *
 * # With specific task
 * pnpm tsx scripts/test-agent.ts "Open Settings app"
 */

import 'dotenv/config';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { AndroidDevice } from '../src/devices/android/device';
import { VisionAgent } from '../src/agents/vision';
import { getDefaultModelConfig } from '../src/agents/vision/modelConfig';
import { convertTrajectoryToTestFlow } from '../src/utils/testFlowConverter';
import {
  configureMobileSdk,
  initializeAgent,
  type IMobileAgent,
  type TaskExecutionResult,
} from '../src';

const execAsync = promisify(exec);

type AgentType = 'vision' | 'text-vision';

interface CLIConfig {
  agentType: AgentType;
  deviceId?: string;
  debugDir?: string;
  appiumHost?: string;
  appiumPort?: number;
}

/**
 * Interactive CLI for Mobile Agents
 */
class MobileAgentCLI {
  private rl!: readline.Interface;
  private device?: AndroidDevice;
  private mobileAgent?: IMobileAgent; // Works for both VisionAgent and TextVisionAgent
  private lastResult?: TaskExecutionResult;
  private config: CLIConfig;
  private isRunning = false;
  private deviceId?: string;

  constructor(config: Partial<CLIConfig> = {}) {
    this.config = {
      agentType: (process.env.AGENT_TYPE as AgentType) || 'text-vision',
      debugDir: process.env.DEBUG_DIR || './logs',
      appiumHost: process.env.APPIUM_HOST || 'localhost',
      appiumPort: parseInt(process.env.APPIUM_PORT || '4723', 10),
      ...config,
    };
  }

  /**
   * Start the interactive CLI
   */
  async start(initialTask?: string): Promise<void> {
    const agentName = this.config.agentType === 'vision' ? 'VisionAgent' : 'TextVisionAgent';
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log(`║     ${agentName} - Interactive CLI                        ║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    try {
      // 1. Initialize Android device
      await this.initializeDevice();

      // 2. Initialize AI agent (includes setup like starting Appium)
      await this.initializeAgent();

      // 3. Run initial task if provided
      if (initialTask) {
        await this.handleTask(initialTask);
      }

      // 6. Display help and start interactive loop
      this.displayHelp();
      await this.startInteractiveLoop();

    } catch (error: any) {
      console.error(`\nError: ${error.message}\n`);
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Initialize Android device (with auto-start if needed)
   */
  private async initializeDevice(): Promise<void> {
    console.log('Initializing Android device...\n');

    let deviceId = this.config.deviceId || process.env.ANDROID_DEVICE;

    if (!deviceId) {
      const devices = await this.listAndroidDevices();

      if (devices.length === 0) {
        console.log('No Android devices found. Starting emulator...\n');
        deviceId = await this.startEmulator();
      } else if (devices.length === 0) {
        throw new Error('No Android devices found. Please start an emulator or connect a device.');
      } else if (devices.length === 1) {
        deviceId = devices[0];
        console.log(`Found device: ${deviceId}\n`);
      } else {
        console.log('Multiple devices found:');
        devices.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
        deviceId = devices[0];
        console.log(`\nUsing first device: ${deviceId}\n`);
      }
    }

    this.deviceId = deviceId;

    // Connect to device
    this.device = new AndroidDevice(deviceId, { remoteAdbPort: 5037 });
    await this.device.connect();
    console.log(`Connected to device: ${deviceId}\n`);

    // Get device info
    const size = await this.device.size();
    console.log(`Screen size: ${size.width}x${size.height}\n`);

    // Enable touch visualization
    await this.enableTouchVisualization();
  }

  /**
   * List connected Android devices
   */
  private async listAndroidDevices(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('adb devices');
      const lines = stdout.split('\n').slice(1);
      const devices: string[] = [];

      for (const line of lines) {
        const match = line.match(/^([\w-]+)\s+device/);
        if (match) {
          devices.push(match[1]);
        }
      }

      return devices;
    } catch (error) {
      console.error('Failed to list devices:', error);
      return [];
    }
  }

  /**
   * Start Android emulator
   */
  private async startEmulator(): Promise<string> {
    console.log('Starting Android emulator...\n');

    const { stdout: avdList } = await execAsync('emulator -list-avds');
    const avds = avdList.trim().split('\n').filter(Boolean);

    if (avds.length === 0) {
      throw new Error('No Android Virtual Devices (AVDs) found. Please create one using Android Studio.');
    }

    const avdName = avds[0];
    console.log(`Starting AVD: ${avdName}...\n`);

    // Start emulator in background
    exec(`emulator -avd ${avdName} -no-snapshot-save -no-audio -no-boot-anim`);

    // Wait for device
    console.log('Waiting for device to boot...\n');
    execSync('adb wait-for-device', { stdio: 'inherit' });

    // Wait for boot complete
    let bootComplete = false;
    for (let i = 0; i < 60; i++) {
      try {
        const { stdout } = await execAsync('adb shell getprop sys.boot_completed');
        if (stdout.trim() === '1') {
          bootComplete = true;
          break;
        }
      } catch {
        // Ignore errors during boot
      }
      await this.sleep(2000);
    }

    if (!bootComplete) {
      throw new Error('Emulator failed to boot within timeout');
    }

    const devices = await this.listAndroidDevices();
    if (devices.length === 0) {
      throw new Error('Emulator started but no device found');
    }

    console.log(`Emulator started: ${devices[0]}\n`);
    return devices[0];
  }

  /**
   * Enable touch visualization
   */
  private async enableTouchVisualization(): Promise<void> {
    try {
      console.log('Enabling touch visualization...');
      await execAsync(`adb -s ${this.deviceId} shell settings put system show_touches 1`);
      console.log('Touch visualization enabled\n');
    } catch {
      console.warn('Failed to enable touch visualization (optional)\n');
    }
  }

  /**
   * Disable touch visualization
   */
  private async disableTouchVisualization(): Promise<void> {
    try {
      await execAsync(`adb -s ${this.deviceId} shell settings put system show_touches 0`);
      console.log('Touch visualization disabled\n');
    } catch {
      // Ignore
    }
  }

  /**
   * Initialize AI agent
   */
  private async initializeAgent(): Promise<void> {
    console.log(`Initializing ${this.config.agentType} agent...\n`);

    if (this.config.agentType === 'vision') {
      const modelConfig = getDefaultModelConfig();
      console.log(`   Provider: ${modelConfig.provider}`);
      console.log(`   Model: ${modelConfig.model}\n`);

      this.mobileAgent = new VisionAgent({
        device: this.device!,
        modelConfig,
        debugDir: this.config.debugDir,
      });

      // Setup agent (no-op for VisionAgent)
      await this.mobileAgent.setup();
    } else {
      // TextVisionAgent via configureMobileSdk + initializeAgent
      console.log(`   Provider: gemini`);
      console.log(`   Model: gemini-3-flash-preview\n`);

      // Configure SDK with settings
      configureMobileSdk({
        provider: 'gemini',
        androidDeviceId: this.deviceId,
        appiumHost: this.config.appiumHost,
        appiumPort: this.config.appiumPort,
        debug: true,
        maxStepsPerTask: 40,
        retryConfig: {
          maxRetries: 1,
          retryDelayMs: 500,
        },
      });

      // Initialize agent using the SDK config
      this.mobileAgent = await initializeAgent({ deviceId: this.deviceId });

      // Setup agent (starts Appium if needed for TextVisionAgent)
      await this.mobileAgent.setup();
    }

    console.log('Agent initialized\n');
  }

  /**
   * Display help
   */
  private displayHelp(): void {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Commands:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  /help        - Show this help');
    console.log('  /show        - Show trajectory summary');
    console.log('  /export      - Export trajectory to TestFlow');
    console.log('  /clear       - Clear trajectory');
    console.log('  /step <task> - Execute single step');
    console.log('  /home        - Press home');
    console.log('  /back        - Press back');
    console.log('  /screenshot  - Take screenshot');
    console.log('  /touch on|off- Toggle touch visualization');
    console.log('  /exit        - Exit');
    console.log('');
    console.log('Or type a task (e.g., "Open Settings")');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  /**
   * Start interactive loop
   */
  private async startInteractiveLoop(): Promise<void> {
    this.isRunning = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    this.rl.prompt();

    this.rl.on('line', async (line: string) => {
      const input = line.trim();
      if (!input) {
        this.rl.prompt();
        return;
      }

      try {
        if (input.startsWith('/')) {
          await this.handleCommand(input);
        } else {
          await this.handleTask(input);
        }
      } catch (error: any) {
        console.error(`\nError: ${error.message}\n`);
      }

      if (this.isRunning) {
        this.rl.prompt();
      }
    });

    this.rl.on('close', async () => {
      await this.cleanup();
    });
  }

  /**
   * Handle command
   */
  private async handleCommand(command: string): Promise<void> {
    const parts = command.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
        this.displayHelp();
        break;

      case 'show':
        await this.showTrajectory();
        break;

      case 'export':
        await this.exportTrajectory(args[0]);
        break;

      case 'clear':
        this.mobileAgent?.resetState?.();
        this.lastResult = undefined;
        console.log('Trajectory cleared.\n');
        break;

      case 'step':
        if (args.length === 0) {
          console.log('Usage: /step <task>\n');
        } else {
          await this.handleSingleStep(args.join(' '));
        }
        break;

      case 'home':
        await this.device!.home();
        console.log('Home pressed\n');
        break;

      case 'back':
        await this.device!.back();
        console.log('Back pressed\n');
        break;

      case 'screenshot':
        await this.takeScreenshot();
        break;

      case 'touch':
        if (args[0]?.toLowerCase() === 'on') {
          await this.enableTouchVisualization();
        } else if (args[0]?.toLowerCase() === 'off') {
          await this.disableTouchVisualization();
        } else {
          console.log('Usage: /touch on|off\n');
        }
        break;

      case 'exit':
      case 'quit':
        console.log('\nGoodbye!\n');
        this.isRunning = false;
        this.rl.close();
        break;

      default:
        console.log(`Unknown command: ${cmd}\n`);
    }
  }

  /**
   * Handle task
   */
  private async handleTask(task: string): Promise<void> {
    console.log(`\nTask: ${task}\n`);

    const result = await this.mobileAgent!.executeTask(task);
    this.lastResult = result;
    console.log(`\nResult: ${result.success ? 'Success' : 'Failed'}`);
    console.log(`Steps: ${result.trajectory.steps}`);
    console.log(`Duration: ${result.metadata.totalDuration}ms\n`);
  }

  /**
   * Handle single step
   */
  private async handleSingleStep(task: string): Promise<void> {
    console.log(`\nStep: ${task}\n`);

    // Both agents now support executeSingleStep via IMobileAgent
    const success = await this.mobileAgent!.executeSingleStep(task);
    console.log(success ? '\nStep completed!\n' : '\nStep failed.\n');
  }

  /**
   * Take screenshot
   */
  private async takeScreenshot(): Promise<void> {
    const screenshot = await this.device!.screenshotBase64();
    const filename = `screenshot-${Date.now()}.png`;

    if (!fs.existsSync(this.config.debugDir!)) {
      fs.mkdirSync(this.config.debugDir!, { recursive: true });
    }

    const filepath = path.join(this.config.debugDir!, filename);
    const base64Data = screenshot.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filepath, base64Data, 'base64');
    console.log(`Screenshot saved: ${filepath}\n`);
  }

  /**
   * Show trajectory
   */
  private async showTrajectory(): Promise<void> {
    // Use unified getLastResult() interface
    const result = this.mobileAgent?.getLastResult?.() || this.lastResult;

    if (!result) {
      console.log('No task executed yet.\n');
      return;
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Session: ${result.metadata.sessionId}`);
    console.log(`Steps: ${result.trajectory.steps}`);
    console.log(`Success: ${result.success}`);
    console.log(`Duration: ${result.metadata.totalDuration}ms`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    for (const step of result.trajectory.stepRecords) {
      // Show action details
      const action = step.actions[0];
      const actionName = action?.action_data.action_name || 'unknown';
      const locator = action?.locator ? ` (${action.locator})` : '';
      console.log(`Step ${step.stepNumber}: ${actionName}${locator}`);

      // Show kwargs if present
      if (action?.action_data.kwargs && Object.keys(action.action_data.kwargs).length > 0) {
        console.log(`  kwargs: ${JSON.stringify(action.action_data.kwargs)}`);
      }

      if (step.thinking) {
        console.log(`  Reasoning: ${step.thinking}`);
      }

      if (!step.outcome.success) {
        console.log(`  Failed - ${step.outcome.error}`);
      }
      console.log('');
    }
  }

  /**
   * Export trajectory
   */
  private async exportTrajectory(outputPath?: string): Promise<void> {
    // Use unified getLastResult() interface
    const result = this.mobileAgent?.getLastResult?.() || this.lastResult;

    if (!result) {
      console.log('No task executed yet.\n');
      return;
    }

    const filepath = outputPath || path.join(
      this.config.debugDir!,
      `trajectory-${result.metadata.sessionId}.json`
    );

    if (!fs.existsSync(this.config.debugDir!)) {
      fs.mkdirSync(this.config.debugDir!, { recursive: true });
    }

    fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
    console.log(`Exported: ${filepath}\n`);
  }

  /**
   * Cleanup
   */
  private async cleanup(): Promise<void> {
    console.log('\nCleaning up...\n');

    if (this.deviceId) {
      await this.disableTouchVisualization();
    }

    // Cleanup agent (stops Appium if started, closes connections)
    if (this.mobileAgent) {
      try {
        await this.mobileAgent.cleanup();
      } catch {
        // Agent may already be cleaned up
      }
    }

    if (this.device) {
      try {
        await this.device.destroy();
      } catch {
        // Device may already be disconnected
      }
    }

    console.log('Done.\n');
    process.exit(0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main
async function main() {
  const task = process.argv[2];
  const cli = new MobileAgentCLI();
  await cli.start(task);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}\n`);
  process.exit(1);
});
