import type { MetadataRoute } from "next";

// Lets people add the portal to their phone's home screen, where it opens full screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LendHous",
    short_name: "LendHous",
    description: "Your LendHous loans, draws and documents.",
    start_url: "/login",
    display: "standalone",
    background_color: "#FAFBF8",
    theme_color: "#202B28",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
  };
}
