import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Img,
} from "remotion";
import { Audio } from "@remotion/media";
import type { AdProps } from "./schema";

const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const font = '"Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif';

function Backdrop({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const dots = Array.from({ length: 36 }, (_, i) => ({
    x: (i * 317 + 19) % 1920,
    y: (i * 173 + 37) % 1080,
  }));
  return (
    <AbsoluteFill style={{ background: "#060d13", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 68% 42%, ${accent}20, transparent 55%), radial-gradient(ellipse at 12% 76%, #3755ff16, transparent 45%)`,
        }}
      />
      <svg
        viewBox="0 0 1920 1080"
        width="100%"
        height="100%"
        style={{ position: "absolute", opacity: 0.25 }}
      >
        <defs>
          <pattern
            id="hex"
            width="136"
            height="118"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M34 0H102L136 59 102 118H34L0 59Z"
              fill="none"
              stroke={accent}
              strokeWidth=".7"
            />
          </pattern>
          <linearGradient id="fade">
            <stop stopColor={accent} stopOpacity="0" />
            <stop offset=".5" stopColor={accent} stopOpacity=".6" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="1920" height="1080" fill="url(#hex)" opacity=".5" />
        {dots.map((p, i) => (
          <circle
            key={i}
            cx={(p.x + frame * (0.15 + (i % 3) * 0.08)) % 1920}
            cy={p.y}
            r={i % 4 === 0 ? 2 : 1}
            fill={accent}
            opacity={0.15 + (i % 6) / 12}
          />
        ))}
        <path
          d={`M0 ${180 + ((frame * 1.4) % 700)} H1920`}
          stroke="url(#fade)"
          strokeWidth="1"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          bottom: -280,
          left: -200,
          right: -200,
          height: 650,
          perspective: 600,
        }}
      >
        <div
          style={{
            height: "100%",
            backgroundImage: `linear-gradient(${accent}20 1px,transparent 1px),linear-gradient(90deg,${accent}20 1px,transparent 1px)`,
            backgroundSize: "90px 90px",
            transform: `rotateX(62deg) translateY(${(frame * 0.5) % 90}px)`,
          }}
        />
      </div>
      <AbsoluteFill style={{ boxShadow: "inset 0 0 200px 70px #0009" }} />
    </AbsoluteFill>
  );
}

function Orbit({
  project,
  assetBase,
  standalone = false,
}: Pick<AdProps, "project" | "assetBase"> & { standalone?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cards = project.labels
    .map((label, i) => {
      const angle =
        (2 * Math.PI * i) / project.labels.length +
        (frame / fps) * 0.48 * project.speed;
      const depth = Math.sin(angle);
      return {
        label,
        i,
        x: Math.cos(angle) * 315 * project.radius,
        y: Math.sin(angle * 1.7 + i * 0.6) * 190 * project.radius,
        depth,
      };
    })
    .sort((a, b) => a.depth - b.depth);
  return (
    <div
      style={{
        position: "absolute",
        width: 920,
        height: 820,
        left: standalone ? 500 : 900,
        top: standalone ? 130 : 120,
        perspective: 1200,
      }}
    >
      <svg
        width="920"
        height="820"
        style={{ position: "absolute", opacity: 0.24 }}
      >
        <ellipse
          cx="460"
          cy="405"
          rx={365 * project.radius}
          ry={215 * project.radius}
          fill="none"
          stroke={project.accent}
          strokeDasharray="3 13"
        />
        <ellipse
          cx="460"
          cy="405"
          rx={365 * project.radius}
          ry={215 * project.radius}
          fill="none"
          stroke={project.accent}
          transform="rotate(-24 460 405)"
        />
      </svg>
      {cards.map(({ label, i, x, y, depth }) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 370 + x,
            top: 315 + y,
            width: 180,
            height: 180,
            borderRadius: 28,
            opacity: interpolate(
              frame,
              [i * 2, i * 2 + 18],
              [0, 0.5 + (depth + 1) * 0.25],
              ease,
            ),
            scale: interpolate(
              frame,
              [i * 2, i * 2 + 24],
              [0.15, 0.82 + (depth + 1) * 0.17],
              ease,
            ),
            transform: `rotateY(${-Math.cos((frame / fps) * 0.48) * 12}deg) rotateZ(${Math.sin(frame / fps + i) * 5}deg)`,
            background: "linear-gradient(140deg,#f1fff9,#d7e9ec)",
            boxShadow: `0 18px 45px #0006, inset 0 0 0 1px #fff9`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 42,
            fontWeight: 800,
            color: "#112e32",
            zIndex: Math.round((depth + 1) * 100),
          }}
        >
          {project.imageAssetIds[i % project.imageAssetIds.length] ? (
            <Img
              src={
                assetBase +
                project.imageAssetIds[i % project.imageAssetIds.length]
              }
              style={{
                width: 142,
                height: 142,
                objectFit: "contain",
                borderRadius: 16,
              }}
            />
          ) : (
            <div style={{ textAlign: "center" }}>
              <svg width="66" height="64" viewBox="0 0 64 64">
                <path
                  d={
                    i % 3 === 0
                      ? "M32 3 59 19V45L32 61 5 45V19Z"
                      : i % 3 === 1
                        ? "M32 3 39 23 61 32 39 41 32 61 24 41 3 32 24 23Z"
                        : "M8 8H56V56H8ZM19 19V45H45V19Z"
                  }
                  fill={i % 2 === 0 ? "#137a6b" : "#6458cf"}
                  fillRule="evenodd"
                />
              </svg>
              <div style={{ fontSize: 30, marginTop: 6 }}>{label}</div>
            </div>
          )}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 365,
          top: 310,
          width: 190,
          height: 190,
          borderRadius: "50%",
          background: `radial-gradient(circle,${project.accent}20,transparent 70%)`,
          border: `1px solid ${project.accent}50`,
          zIndex: 90,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 52,
          fontWeight: 800,
          color: project.accent,
          letterSpacing: 5,
          scale: 1 + Math.sin((frame / fps) * 2) * 0.035,
        }}
      >
        N/X
      </div>
    </div>
  );
}

function Intro(props: AdProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = props.project;
  return (
    <>
      <Backdrop accent={p.accent} />
      <Orbit {...props} />
      <div style={{ position: "absolute", left: 118, top: 225, width: 780 }}>
        <div
          style={{
            color: p.accent,
            fontSize: 23,
            letterSpacing: 10,
            opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], ease),
          }}
        >
          NEXUS / MOTION LAB
        </div>
        <div
          style={{
            fontSize: Math.min(
              116,
              Math.max(
                52,
                740 /
                  Math.max(
                    ...p.headline
                      .split(/[，,]/)
                      .map((v) =>
                        [...v].reduce(
                          (n, c) => n + (/[\x00-\x7f]/.test(c) ? 0.6 : 1),
                          0,
                        ),
                      ),
                    1,
                  ),
              ),
            ),
            fontWeight: 900,
            letterSpacing: -4,
            lineHeight: 1.22,
            whiteSpace: "pre-line",
            overflowWrap: "anywhere",
            textWrap: "balance",
            marginTop: 34,
            color: "#effdf7",
            translate: interpolate(
              frame,
              [0, 0.85 * fps],
              ["0px 80px", "0px 0px"],
              ease,
            ),
            opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], ease),
          }}
        >
          {p.headline.replace(/[，,]/, "，\n")}
        </div>
        <div
          style={{
            height: 3,
            width: interpolate(frame, [0.5 * fps, 1.5 * fps], [0, 560], ease),
            background: p.accent,
            marginTop: 40,
            boxShadow: `0 0 24px ${p.accent}`,
          }}
        />
        <div
          style={{
            fontSize: 26,
            lineHeight: 1.7,
            color: "#a7c1c4",
            marginTop: 30,
            letterSpacing: 2,
          }}
        >
          {p.tagline}
        </div>
        <div
          style={{
            fontSize: 18,
            letterSpacing: 5,
            color: "#65858d",
            marginTop: 58,
          }}
        >
          DESIGN · MOTION · SOUND
        </div>
      </div>
    </>
  );
}

function DataScene({
  project,
  assetBase,
}: Pick<AdProps, "project" | "assetBase">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = project;
  const progress = interpolate(frame, [0.4 * fps, 2.8 * fps], [0, 1], ease);
  const max = Math.max(...p.values, 1);
  return (
    <>
      <Backdrop accent={p.accent} />
      <div
        style={{
          position: "absolute",
          inset: "105px 110px",
          border: `1px solid ${p.accent}70`,
          clipPath: "polygon(0 0,97% 0,100% 5%,100% 100%,3% 100%,0 95%)",
          background: "#050e14b0",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 160,
          top: 145,
          fontSize: 23,
          color: p.accent,
          letterSpacing: 7,
        }}
      >
        NEXUS / DATA IN MOTION
      </div>
      <div
        style={{
          position: "absolute",
          left: 160,
          top: 205,
          fontSize: 62,
          fontWeight: 800,
          color: "#edfff9",
        }}
      >
        {p.headline}
      </div>
      <div
        style={{
          position: "absolute",
          left: 160,
          top: 295,
          fontSize: 24,
          color: "#7f9da7",
        }}
      >
        示例数据 · 可替换为你的产品指标
      </div>
      <svg
        viewBox="0 0 1100 570"
        style={{
          position: "absolute",
          left: 125,
          top: 380,
          width: 1100,
          height: 570,
        }}
      >
        <defs>
          <linearGradient id="bar" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor={p.accent} />
            <stop offset="1" stopColor={p.accent} stopOpacity=".08" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <path
            key={i}
            d={`M40 ${465 - i * 100}H1050`}
            stroke={p.accent}
            strokeOpacity=".14"
          />
        ))}
        {p.values.map((value, i) => {
          const h =
            (value / max) *
            350 *
            interpolate(
              frame,
              [0.5 * fps + i * 4, 2.4 * fps + i * 4],
              [0, 1],
              ease,
            );
          return (
            <g key={i}>
              <rect
                x={115 + i * 245}
                y={465 - h}
                width="120"
                height={Math.max(0.1, h)}
                fill="url(#bar)"
              />
              <path
                d={`M${115 + i * 245} ${465 - h}h120`}
                stroke={p.accent}
                strokeWidth="3"
              />
              <text
                x={175 + i * 245}
                y={442 - h}
                textAnchor="middle"
                fill="#edfff9"
                fontSize="32"
                fontWeight="700"
              >
                {Math.round(value * progress).toLocaleString("en-US")}
              </text>
              <text
                x={175 + i * 245}
                y="515"
                textAnchor="middle"
                fill="#91b0b9"
                fontSize="23"
              >
                {p.labels[i] || `Q${i + 1}`}
              </text>
            </g>
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 1310,
          top: p.imageAssetIds.length ? 220 : 365,
          width: 390,
        }}
      >
        {p.imageAssetIds.length > 0 && (
          <Img
            src={assetBase + p.imageAssetIds[0]}
            style={{
              width: 390,
              height: 420,
              objectFit: "contain",
              border: `1px solid ${p.accent}60`,
              marginBottom: 25,
              opacity: interpolate(frame, [0, fps], [0, 1], ease),
            }}
          />
        )}
        <div
          style={{
            height: 4,
            width: 70,
            background: p.accent,
            marginBottom: 25,
          }}
        />
        <div style={{ color: "#8daab3", fontSize: 23, letterSpacing: 3 }}>
          TOTAL / 指标汇总
        </div>
        <div
          style={{
            color: p.accent,
            fontSize: 80,
            fontWeight: 800,
            letterSpacing: -4,
            marginTop: 24,
          }}
        >
          {Math.round(
            p.values.reduce((a, b) => a + b, 0) * progress,
          ).toLocaleString("en-US")}
        </div>
        <div
          style={{
            fontSize: 25,
            color: "#d0e0e3",
            lineHeight: 1.8,
            marginTop: 20,
          }}
        >
          {p.tagline}
        </div>
      </div>
    </>
  );
}

function GridScene({ project }: Pick<AdProps, "project">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <>
      <Backdrop accent={project.accent} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div style={{ color: project.accent, fontSize: 26, letterSpacing: 14 }}>
          NEXUS / CREATIVE SIGNAL
        </div>
        <div
          style={{
            color: "#f0fff9",
            fontWeight: 900,
            fontSize: 120,
            marginTop: 28,
            letterSpacing: -5,
            opacity: interpolate(frame, [0, fps], [0, 1], ease),
            scale: interpolate(frame, [0, 1.2 * fps], [0.82, 1], ease),
          }}
        >
          {project.headline}
        </div>
        <div
          style={{
            fontSize: 30,
            color: "#9cbbbe",
            marginTop: 36,
            letterSpacing: 4,
          }}
        >
          {project.tagline}
        </div>
        <div style={{ marginTop: 95, display: "flex", gap: 18 }}>
          {project.labels.slice(0, 4).map((label, i) => (
            <div
              key={i}
              style={{
                padding: "20px 45px",
                border: `1px solid ${project.accent}50`,
                fontSize: 25,
                color: project.accent,
                opacity: interpolate(
                  frame,
                  [fps + i * 5, fps + i * 5 + 18],
                  [0, 1],
                  ease,
                ),
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Soundtrack({
  project,
  assetBase,
}: Pick<AdProps, "project" | "assetBase">) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <>
      {project.music.enabled && (
        <Audio
          name="背景音乐"
          src={
            project.music.assetId
              ? assetBase + project.music.assetId
              : staticFile("audio/nexus-score.wav")
          }
          loop
          volume={
            project.music.gain *
            interpolate(
              frame,
              [0, 0.5 * fps, durationInFrames - fps, durationInFrames],
              [0, 1, 1, 0],
              ease,
            )
          }
        />
      )}
      {project.sfx.map((event, i) => (
        <Audio
          key={i}
          name={`${event.type} / ${event.time}s`}
          from={Math.round(event.time * fps)}
          src={staticFile(`audio/${event.type}.wav`)}
          volume={event.gain}
        />
      ))}
    </>
  );
}

export const AdFilm: React.FC<AdProps> = (props) => {
  const { project: p } = props;
  const { fps, width, height } = useVideoConfig();
  const length = Math.round(p.duration * fps),
    a = Math.round(length / 3),
    b = Math.round((length * 2) / 3);
  // All visual coordinates use a fixed design canvas, scaled equally for preview
  // and render. Every motion is driven by Remotion frame time, never CSS timers.
  return (
    <AbsoluteFill
      style={{
        background: props.transparent ? "transparent" : "#060d13",
        fontFamily: font,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 1920,
          height: 1080,
          transform: `scale(${width / 1920},${height / 1080})`,
          transformOrigin: "0 0",
        }}
      >
        {p.template === "showcase" ? (
          <>
            <Sequence name="01 产品卡片与标题" durationInFrames={a}>
              <Intro {...props} />
            </Sequence>
            <Sequence name="02 HUD 数据广告" from={a} durationInFrames={b - a}>
              <DataScene project={p} assetBase={props.assetBase} />
            </Sequence>
            <Sequence name="03 品牌片尾" from={b} durationInFrames={length - b}>
              <GridScene project={p} />
            </Sequence>
          </>
        ) : p.template === "cloud" ? (
          <>
            {!props.transparent && <Backdrop accent={p.accent} />}
            <Orbit {...props} standalone />
          </>
        ) : p.template === "hud" ? (
          <DataScene project={p} assetBase={props.assetBase} />
        ) : (
          <GridScene project={p} />
        )}
        {!props.transparent && (
          <div
            style={{
              position: "absolute",
              bottom: 49,
              left: 115,
              right: 115,
              display: "flex",
              justifyContent: "space-between",
              color: "#6a8992",
              fontSize: 17,
              letterSpacing: 4,
            }}
          >
            <span>NEXUS FX STUDIO</span>
            <span>MOTION / {p.template.toUpperCase()}</span>
          </div>
        )}
      </div>
      <Soundtrack project={p} assetBase={props.assetBase} />
    </AbsoluteFill>
  );
};
