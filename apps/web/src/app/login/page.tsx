"use client";

import { Button } from "@vango-panel/ui/components/button";
import { FaDiscord } from 'react-icons/fa'
import { Card } from "@vango-panel/ui/components/card"
import { authClient } from "@/lib/auth-client";


export default function LoginPage() {

  return (
    <Card className="mx-auto w-full mt-10 max-w-md p-6 h-fit">
      <h1 className="mb-6 text-center text-3xl font-bold">Welcome Back, please authenticate.</h1>

      <div className="mt-4 text-center">
        <Button variant="secondary" onClick={() => {
          authClient.signIn.social({
            provider: "discord"
          })
        }}>
          <FaDiscord /> Login with discord
        </Button>
      </div>
    </Card>
  )
}
