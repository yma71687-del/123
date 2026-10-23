import { Composition } from "remotion";
import { AdFilm } from "./AdFilm";
import { defaultAd } from "./schema";
export const VideoRoot = () => (
  <Composition
    id="NexusAd"
    component={AdFilm}
    durationInFrames={450}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{
      project: defaultAd,
      assetBase: "/api/assets/",
      resolution: "1080p" as const,
      transparent: false,
    }}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.round(props.project.duration * 30),
      width: props.resolution === "1080p" ? 1920 : 1280,
      height: props.resolution === "1080p" ? 1080 : 720,
    })}
  />
);
