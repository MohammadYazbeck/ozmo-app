import type { Metadata } from "next";
import OzmoApp from "./OzmoApp";

export const metadata: Metadata = {
  title: "OZMO · Content Operations",
  description:
    "OZMO's private office workspace for content production, publishing, inventory and sessions.",
};

export default function Home() {
  return <OzmoApp />;
}
