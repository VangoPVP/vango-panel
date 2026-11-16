import prisma from "@vango-panel/db";

import { encryptSecret } from "./crypto";

const NODE = {
  name: "dev-node",
  url: "http://127.0.0.1:8080",
  sftpHost: "127.0.0.1",
  sftpPort: 2022,
  tokenId: "dev-token-id",
  token: "dev-node-token",
};

const TEMPLATE = {
  name: "Test yolk",
  description: "Tiny busybox server from wings/dev/yolk. Echoes console input; `stop` exits.",
  image: "wings-test-yolk",
  dockerImages: { "Test yolk (busybox)": "wings-test-yolk" },
  startup:
    'echo "Starting {{SERVER_NAME}} on {{SERVER_IP}}:{{SERVER_PORT}} with {{SERVER_MEMORY}}MiB"; ' +
    'echo "Done (0.1s)! For help, type stop"; ' +
    'while read -r line; do if [ "$line" = "stop" ]; then echo "Stopping..."; exit 0; fi; echo "> $line"; done',
  stopType: "command",
  stopValue: "stop",
  startupDone: ["Done ("],
  installImage: "busybox:latest",
  installEntrypoint: "sh",
  installScript:
    'echo "Installing into /mnt/server"\ncd /mnt/server\necho "Hello from the installer" > README.txt\necho "Install finished"\n',
  variables: [
    { key: "SERVER_NAME", name: "Server name", description: "Shown at startup", default: "yolk", userEditable: true },
  ],
};

async function main() {
  const node = await prisma.node.upsert({
    where: { tokenId: NODE.tokenId },
    create: {
      name: NODE.name,
      url: NODE.url,
      sftpHost: NODE.sftpHost,
      sftpPort: NODE.sftpPort,
      tokenId: NODE.tokenId,
      tokenEncrypted: encryptSecret(NODE.token),
    },
    // sftpHost is deliberately not reset: it doubles as the node's public address (Admin → Nodes).
    update: { url: NODE.url, sftpPort: NODE.sftpPort, tokenEncrypted: encryptSecret(NODE.token) },
  });
  console.log(`node      ${node.name} (${node.id}) → ${node.url}`);

  const ports = [25565, 25566, 25567, 25568, 25569, 25570];
  const created = await prisma.allocation.createMany({
    // Bind on all interfaces; the panel shows the node's SFTP host as the connect address.
    data: ports.map((port) => ({ nodeId: node.id, ip: "0.0.0.0", port })),
    skipDuplicates: true,
  });
  console.log(`allocs    0.0.0.0:${ports[0]}-${ports.at(-1)} (${created.count} new)`);

  const { name, ...rest } = TEMPLATE;
  const template = await prisma.template.upsert({ where: { name }, create: TEMPLATE, update: rest });
  console.log(`template  ${template.name} (${template.id})`);

  const i = process.argv.indexOf("--admin");
  const email = i >= 0 ? process.argv[i + 1] : undefined;
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
  const superAdmin = users.find((u) => u.role === "superadmin");
  console.log(`superadmin ${superAdmin?.email ?? "none yet: the first account to sign up becomes super admin"}`);
  if (email) {
    const target = users.find((u) => u.email === email);
    if (!target) console.log(`admin     no user with email ${email}; sign up first, then re-run`);
    else if (target.role === "superadmin") console.log(`admin     ${email} is the super admin; unchanged`);
    else {
      await prisma.user.update({ where: { id: target.id }, data: { role: "admin" } });
      console.log(`admin     ${target.email}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
