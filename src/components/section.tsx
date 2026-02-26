import type { HTMLAttributes } from "react";

export function Section({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={"mx-auto max-w-6xl px-4 py-14 md:py-20 " + (className ?? "")} {...props} />
  );
}
