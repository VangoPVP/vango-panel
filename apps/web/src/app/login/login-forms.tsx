"use client";

import { useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function LoginForms() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");

  return mode === "sign-in" ? (
    <SignInForm onSwitchToSignUp={() => setMode("sign-up")} />
  ) : (
    <SignUpForm onSwitchToSignIn={() => setMode("sign-in")} />
  );
}
