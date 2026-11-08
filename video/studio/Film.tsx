import {
  AbsoluteFill,
  Freeze,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { useId } from "react";
import { AdFilm } from "../AdFilm";
import { CaptionOverlay } from "../CaptionOverlay";
import { builtInAudio, projectMedia } from "../mediaSource";
import { FlyingWords } from "../shotcraft/demos/typography/flying-words/FlyingWords";
import { transformAt, type StudioProject, type StudioShot } from "./schema";

const font = '"Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif';
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function Product({ accent }: { accent: string }) {
  const suffix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const metal = "studio-metal-" + suffix,
    core = "studio-core-" + suffix;
  return (
    <svg
      viewBox="0 0 600 600"
      width="100%"
      height="100%"
      aria-label="内置抽象产品示范"
    >
      <defs>
        <linearGradient id={metal} x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#e9f5f4" />
          <stop offset=".3" stopColor="#697c83" />
          <stop offset=".53" stopColor="#192e3a" />
          <stop offset=".8" stopColor="#708c95" />
          <stop offset="1" stopColor="#e3eff0" />
        </linearGradient>
        <radialGradient id={core}>
          <stop stopColor="#f0ffff" />
          <stop offset=".3" stopColor={accent} />
          <stop offset="1" stopColor="#12292d" />
        </radialGradient>
      </defs>
      <rect
        x="130"
        y="100"
        width="340"
        height="400"
        rx="110"
        fill={`url(#${metal})`}
        stroke="#d0f5f5"
        strokeWidth="3"
      />
      <rect x="148" y="119" width="304" height="363" rx="95" fill="#0a171d" />
      <circle cx="300" cy="285" r="105" fill={`url(#${core})`} />
      <circle
        cx="300"
        cy="285"
        r="115"
        fill="none"
        stroke={accent}
        strokeWidth="2"
      />
      <path
        d="M260 395h80"
        stroke="#91c1c9"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Hero({ shot, assetBase }: { shot: StudioShot; assetBase: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = shot.params;
  const enter = interpolate(frame, [0, 0.8 * fps], [0.35, 1], clamp);
  const progress = frame / Math.max(1, shot.sourceDurationFrames - 1);
  return (
    <AbsoluteFill
      style={{
        background: "#090f16",
        color: "#f2f7fa",
        overflow: "hidden",
        fontFamily: font,
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 73% 45%, ${p.accent}32, transparent 56%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 970,
          top: 860,
          width: 670,
          height: 80,
          borderRadius: "50%",
          background: p.accent + "35",
          filter: "blur(48px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 106,
          left: 130,
          letterSpacing: 10,
          fontSize: 28,
          color: p.accent,
        }}
      >
        {p.brand} / PRODUCT FILM
      </div>
      <div
        style={{
          position: "absolute",
          left: 130,
          top: 345,
          width: 850,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 40}px)`,
        }}
      >
        <div
          style={{
            width: 80,
            height: 4,
            background: p.accent,
            marginBottom: 40,
          }}
        />
        <div
          style={{
            fontSize: p.headline.length > 16 ? 72 : 96,
            lineHeight: 1.35,
            fontWeight: 750,
            letterSpacing: -3,
            overflowWrap: "anywhere",
          }}
        >
          {p.headline}
        </div>
        <div
          style={{
            fontSize: 30,
            lineHeight: 1.7,
            color: "#a9bac8",
            marginTop: 34,
          }}
        >
          {p.subtitle}
        </div>
        <div
          style={{ display: "flex", gap: 22, marginTop: 54, flexWrap: "wrap" }}
        >
          {p.keywords.slice(0, 3).map((k, i) => (
            <span
              key={i}
              style={{
                padding: "12px 24px",
                border: "1px solid #ffffff25",
                borderRadius: 40,
                color: "#d4dfe6",
                fontSize: 24,
              }}
            >
              {k}
            </span>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1020,
          top: 190,
          width: 690,
          height: 690,
          opacity: enter,
          transform: `perspective(1400px) rotateY(${-12 + progress * 20}deg) rotateZ(${-4 + progress * 6}deg) translateY(${(1 - enter) * 60}px) scale(${0.94 + progress * 0.06})`,
          filter: "drop-shadow(0 40px 70px #0008)",
        }}
      >
        {p.imageAssetIds[0] ? (
          <Img
            src={projectMedia(assetBase, p.imageAssetIds[0])}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <Product accent={p.accent} />
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: 130,
          bottom: 90,
          right: 130,
          borderTop: "1px solid #ffffff20",
          paddingTop: 24,
          display: "flex",
          justifyContent: "space-between",
          color: "#7c92a4",
          fontSize: 22,
        }}
      >
        <span>{p.brand}</span>
        <span>DESIGNED TO MOVE</span>
      </div>
    </AbsoluteFill>
  );
}
function Layers({ shot, assetBase }: { shot: StudioShot; assetBase: string }) {
  const frame = useCurrentFrame(),
    p = shot.params;
  const progress = frame / Math.max(1, shot.sourceDurationFrames - 1);
  const spread = Math.sin(Math.PI * progress) ** 2;
  const count = p.imageAssetIds.length || 3;
  return (
    <AbsoluteFill
      style={{
        background: "#e8eef1",
        color: "#15232d",
        fontFamily: font,
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 65% 40%, ${p.accent}35, transparent 65%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 85,
          color: "#435a69",
          letterSpacing: 8,
          fontSize: 26,
        }}
      >
        {p.brand} / LAYERS
      </div>
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 160,
          fontSize: 72,
          fontWeight: 750,
          maxWidth: 1550,
          lineHeight: 1.3,
        }}
      >
        {p.headline}
      </div>
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 280,
          fontSize: 30,
          color: "#627683",
        }}
      >
        {p.subtitle}
      </div>
      <div
        style={{
          position: "absolute",
          left: 400,
          top: 400,
          width: 1120,
          height: 520,
          perspective: 2200,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformStyle: "preserve-3d",
            transform: `rotateX(45deg) rotateZ(${-17 + progress * 7}deg)`,
          }}
        >
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                inset: 0,
                background:
                  p.imageAssetIds.length || i > 0 ? "transparent" : "#ffffff",
                border:
                  p.imageAssetIds.length || i > 0
                    ? "none"
                    : "2px solid #c8d4dc",
                borderRadius: 28,
                boxShadow: "0 35px 65px #21374920",
                transform: `translateZ(${i * 95 * spread}px) translateX(${(i - (count - 1) / 2) * 65 * spread}px)`,
                overflow: "hidden",
              }}
            >
              {p.imageAssetIds[i] ? (
                <Img
                  src={projectMedia(assetBase, p.imageAssetIds[i])}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    gap: 70,
                  }}
                >
                  <div
                    style={{
                      width: 330,
                      height: 330,
                      opacity: i === 1 ? 1 : 0,
                    }}
                  >
                    <Product accent={p.accent} />
                  </div>
                  <div style={{ opacity: i === 2 ? 1 : 0 }}>
                    <div style={{ fontSize: 60, fontWeight: 700 }}>
                      {p.brand}
                    </div>
                    <div
                      style={{ fontSize: 28, marginTop: 20, color: "#637984" }}
                    >
                      {p.keywords.slice(0, 3).join(" / ")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}
function ShotVisual({
  shot,
  assetBase,
}: {
  shot: StudioShot;
  assetBase: string;
}) {
  const frame = useCurrentFrame();
  const sourceFrame = frame + shot.sourceInFrame;
  const t = transformAt(shot, sourceFrame);
  return (
    <AbsoluteFill
      data-testid={"studio-visual-" + shot.id}
      data-source-frame={sourceFrame}
      style={{
        opacity: t.opacity,
        transform: `translate(${t.x}px,${t.y}px) scale(${t.scale})`,
      }}
    >
      <Freeze frame={sourceFrame}>
        {shot.recipe === "hero" ? (
          <Hero shot={shot} assetBase={assetBase} />
        ) : shot.recipe === "layers" ? (
          <Layers shot={shot} assetBase={assetBase} />
        ) : shot.recipe === "tunnel" ? (
          <FlyingWords {...shot.params} duration={shot.sourceDurationFrames} />
        ) : shot.legacyAd ? (
          <AdFilm
            project={{
              ...shot.legacyAd,
              music: { ...shot.legacyAd.music, enabled: false },
              sfx: [],
              captions: { ...shot.legacyAd.captions, enabled: false },
            }}
            assetBase={assetBase}
            resolution="1080p"
            transparent={false}
          />
        ) : null}
      </Freeze>
    </AbsoluteFill>
  );
}
export type StudioProps = {
  project: StudioProject;
  assetBase: string;
  resolution: "720p" | "1080p";
};
export function StudioFilm({ project, assetBase }: StudioProps) {
  const { width, fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#080d14" }}>
      <div
        style={{
          position: "absolute",
          width: 1920,
          height: 1080,
          transform: `scale(${width / 1920})`,
          transformOrigin: "top left",
        }}
      >
        {project.shots
          .filter((s) => s.enabled)
          .map((shot) => (
            <Sequence
              key={shot.id}
              from={shot.startFrame}
              durationInFrames={shot.durationFrames}
              width={1920}
              height={1080}
              premountFor={fps}
            >
              <ShotVisual shot={shot} assetBase={assetBase} />
            </Sequence>
          ))}
        <CaptionOverlay
          track={project.captions}
          accent={project.shots[0].params.accent}
        />
      </div>
      {project.audio
        .filter((a) => !a.muted && a.gain > 0)
        .map((clip) => (
          <Audio
            key={clip.id}
            name={clip.kind}
            src={
              clip.assetId
                ? projectMedia(assetBase, clip.assetId)
                : builtInAudio(
                    clip.builtin === "pulse"
                      ? "audio/nexus-score.wav"
                      : `audio/${clip.builtin}.wav`,
                  )
            }
            from={clip.startFrame}
            durationInFrames={clip.durationFrames}
            trimBefore={clip.sourceInFrame}
            premountFor={fps}
            loop={clip.kind === "music"}
            volume={clip.gain}
          />
        ))}
    </AbsoluteFill>
  );
}
