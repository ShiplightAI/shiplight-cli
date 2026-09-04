# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through
[GitHub Security Advisories](https://github.com/ShiplightAI/shiplight-cli/security/advisories/new),
or by email to security@shiplight.ai. We aim to acknowledge within three
working days and to keep you informed while we investigate.

Please include what you need us to reproduce it: affected version
(`shiplight --version`), platform, and the smallest set of steps that shows the
problem. If you have a proof of concept, send it privately rather than
publishing it.

We will credit you in the advisory unless you would rather stay anonymous.

## Supported versions

Fixes land on the latest released version of each published package
(`shiplightai`, `@shiplightai/mcp`, `@shiplightai/sdk`). There are no
long-term support branches; upgrading to the current release is the supported
path to a fix.

## Scope

This repository holds the CLI, the MCP server, and the SDKs — code that runs on
a developer's machine or in their CI. Reports that are in scope include:

- code execution triggered by a `.test.yaml` file, a test report, or MCP tool
  input that a user did not intend to be executable
- credential handling: API tokens read from the environment or `.env` being
  written to reports, logs, or uploaded artifacts
- the published npm tarballs: supply-chain issues in what we ship
- the debugger's local HTTP server accepting input it should not

Out of scope: findings against the hosted Shiplight service (report those to
the same address, but they are not fixed here), and vulnerabilities in
third-party dependencies without a demonstrated impact on this code — those
belong upstream, though we are glad to hear about them.

## Telemetry and data handling

The CLI and MCP server send anonymous usage events. What is collected, and how
to turn it off, is documented in each package's README. If you find that either
transmits more than is documented, treat it as a security report and use the
private channel above — that would be a defect, not a feature.
