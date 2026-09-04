/** Check if performance profiling is enabled via SHIPLIGHT_PERF_PROFILING env var. */
export function isPerfProfiling(): boolean {
  return !!process.env.SHIPLIGHT_PERF_PROFILING;
}
