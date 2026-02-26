import { forwardRef } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

function cn(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline";
  size?: "md" | "sm";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", ...props },
  ref
) {
  const base =
    "inline-flex items-center justify-center rounded-md font-medium transition focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { md: "h-10 px-4 text-sm", sm: "h-9 px-3 text-sm" }[size];
  const variants = {
    primary: "bg-white text-ink-950 hover:bg-white/90 shadow-soft ring-1 ring-white/10",
    ghost: "bg-transparent text-white/80 hover:text-white hover:bg-white/10",
    outline: "bg-transparent text-white ring-1 ring-white/15 hover:bg-white/10"
  }[variant];

  return <button ref={ref} className={cn(base, sizes, variants, className)} {...props} />;
});

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75",
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/12 bg-white/[0.03] shadow-soft backdrop-blur",
        className
      )}
      {...props}
    />
  );
}
