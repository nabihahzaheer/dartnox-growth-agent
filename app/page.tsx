import { redirect } from "next/navigation";

/** The console is the product's front door — it is what the operator opens in the morning and the
 *  screen the brief weights above the others. `/` sends you there rather than being a landing page
 *  that has to be clicked past. */
export default function Home() {
  // Temporary. The rebuilt console takes this route; until it exists, `/` serves v1 so the
  // deployment keeps working exactly as it did on `main`.
  redirect("/v1/console");
}
