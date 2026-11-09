// Remembers when each series last recorded, so consecutive delta windows meet without gaps.
export class SeriesClock {
  private readonly lastTime = new Map<string, bigint>()

  // Returns where the window ending at `time` starts, then moves the series forward.
  advance(seriesId: string, time: bigint): bigint {
    const start = this.lastTime.get(seriesId) ?? time
    this.lastTime.set(seriesId, time)
    return start
  }
}
