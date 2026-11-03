import { Config } from "@remotion/cli/config";

// PNG frames keep UI text crisp and give a standard yuv420p (limited-range) H.264.
Config.setVideoImageFormat("png");
Config.setConcurrency(6);
Config.setChromiumOpenGlRenderer("angle");
