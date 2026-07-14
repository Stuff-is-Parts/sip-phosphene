/** Record the live canvas to a downloadable WebM — Plane9 Studio's video export, one web API. */

export class CanvasRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get active(): boolean {
    return this.rec !== null && this.rec.state === "recording";
  }

  start(canvas: HTMLCanvasElement): void {
    if (this.active) return;
    const stream = canvas.captureStream(60);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    this.chunks = [];
    this.rec = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 12_000_000,
    });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
  }

  stop(filename = "phosphene.webm"): void {
    const rec = this.rec;
    if (!rec) return;
    rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: rec.mimeType || "video/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      this.chunks = [];
    };
    rec.stop();
    this.rec = null;
  }
}
