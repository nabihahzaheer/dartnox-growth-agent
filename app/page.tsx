import { redirect } from "next/navigation";

/** The console is the product's front door — it is what the operator opens in the morning and the
 *  screen the brief weights above the others. `/` sends you there rather than being a landing page
 *  that has to be clicked past. */
export default function Home() {
  redirect("/console");
}
