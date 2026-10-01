// A link to a screen the app doesn't have goes to the start, not to expo-router's Unmatched
// page (whose "Sitemap" link crashed in a release build).
import { Redirect } from "expo-router";

export default function NotFound() {
  return <Redirect href="/" />;
}
