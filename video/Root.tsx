import { Composition } from "remotion";
import { AdFilm } from "./AdFilm";
import { adSchema, defaultAd } from "./schema";
import { StudioFilm } from "./studio/Film";
import { studioSchema, defaultStudio } from "./studio/schema";
export const VideoRoot = () => (
  <>
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
      calculateMetadata={({ props }) => {
        const project = adSchema.parse(props.project);
        return {
          props: { ...props, project },
          durationInFrames: Math.round(project.duration * 30),
          width: props.resolution === "1080p" ? 1920 : 1280,
          height: props.resolution === "1080p" ? 1080 : 720,
        };
      }}
    />
    <Composition
      id="NexusStudio"
      component={StudioFilm}
      durationInFrames={450}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        project: defaultStudio(),
        assetBase: "/api/assets/",
        resolution: "1080p" as const,
      }}
      calculateMetadata={({ props }) => {
        const project = studioSchema.parse(props.project);
        return {
          props: { ...props, project },
          durationInFrames: project.durationFrames,
          width: props.resolution === "720p" ? 1280 : 1920,
          height: props.resolution === "720p" ? 720 : 1080,
        };
      }}
    />
  </>
);
