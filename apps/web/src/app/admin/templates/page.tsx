"use client";
import { useQuery } from "@tanstack/react-query";
import { Button, buttonVariants } from "@vango-panel/ui/components/button";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { PageShell, Table } from "@/components/form";
import { trpc } from "@/utils/trpc";

import { ImportEggs } from "./import-eggs";

export default function TemplatesPage() {
  const templates = useQuery(trpc.admin.templates.list.queryOptions());
  const [importing, setImporting] = useState(false);
  return (
    <PageShell
      title="Templates"
      description="How servers are installed and run: image, startup command, stop behaviour, variables."
      actions={
        <>
          <Button variant="outline" onClick={() => setImporting((v) => !v)}>
            {importing ? "Close import" : "Import egg"}
          </Button>
          <Link className={buttonVariants()} href={"/admin/templates/new" as Route}>
            New template
          </Link>
        </>
      }
    >
      {importing ? (
        <ImportEggs existingNames={templates.data?.map((t) => t.name) ?? []} onDone={() => setImporting(false)} />
      ) : null}
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Images</th>
            <th>Variables</th>
            <th>Servers</th>
          </tr>
        </thead>
        <tbody>
          {templates.data?.map((t) => (
            <tr key={t.id}>
              <td>
                <Link className="underline underline-offset-2" href={`/admin/templates/${t.id}` as Route}>
                  {t.name}
                </Link>
                <div className="text-muted-foreground">{t.description}</div>
              </td>
              <td>
                <div className="font-mono">{t.image}</div>
                {Object.keys(t.dockerImages).length > 1 ? (
                  <div className="text-muted-foreground">+{Object.keys(t.dockerImages).length - 1} more</div>
                ) : null}
              </td>
              <td className="font-mono">{t.variables.map((v) => v.key).join(", ") || "–"}</td>
              <td>{t.servers}</td>
            </tr>
          ))}
          {templates.data?.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-muted-foreground">
                No templates yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </PageShell>
  );
}
