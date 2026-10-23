import type { CaptionTrack } from "./captions";
import { captionAtFrame, captionTextLayout } from "./captions";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/** A single full-film caption track, using the film's absolute frame clock. */
export function CaptionOverlay({
  track,
  accent,
}: {
  track: CaptionTrack;
  accent: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cue = track.enabled
    ? captionAtFrame(track.cues, frame, fps)
    : undefined;
  if (!cue) return null;
  const layout = captionTextLayout(track, cue.text);
  const local = frame - Math.ceil((cue.startMs * fps) / 1000);
  const end =
    Math.ceil((cue.endMs * fps) / 1000) - Math.ceil((cue.startMs * fps) / 1000);
  const entrance = Math.min(5, Math.max(1, Math.floor(end / 3)));
  return (
    <div
      data-testid="caption-overlay"
      style={{
        position: "absolute",
        left: 180,
        right: 180,
        ...(track.position === "bottom" ? { bottom: 115 } : { top: 115 }),
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          boxSizing: "border-box",
          padding: track.style === "plain" ? "0 12px" : "16px 30px",
          color: track.color,
          fontWeight: 800,
          fontSize: layout.fontSize,
          lineHeight: 1.35,
          textAlign: "center",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          textShadow: "0 2px 4px #000, 0 0 10px #000",
          borderRadius: 12,
          background: track.style === "plain" ? "transparent" : "#06101ee8",
          border: track.style === "tech" ? `2px solid ${accent}a0` : undefined,
          boxShadow:
            track.style === "tech" ? `0 0 30px ${accent}25` : undefined,
          opacity:
            track.style === "plain"
              ? 1
              : interpolate(local, [0, entrance], [0.35, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
          scale:
            track.style === "pop"
              ? interpolate(
                  local,
                  [0, entrance, entrance + 3],
                  [0.88, 1.035, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                )
              : 1,
          translate:
            track.style === "tech"
              ? `0 ${interpolate(local, [0, entrance], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px`
              : "0 0",
        }}
      >
        {layout.lines.join("\n")}
      </div>
    </div>
  );
}
