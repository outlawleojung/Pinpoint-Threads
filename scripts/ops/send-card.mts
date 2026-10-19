import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
const id = process.argv[2]!;
const alts = JSON.parse(process.argv[3]!) as string[];
const p = await prisma.post.findUniqueOrThrow({ where: { id } });
await prisma.post.update({ where: { id }, data: { generatedBody: alts[0], sourceBrief: { ...((p.sourceBrief as object) ?? {}), rationale: { situation: process.argv[4]! }, altBodies: alts } as never } });
await sendApprovalRequest(id);
console.log('SENT');
await prisma.$disconnect(); process.exit(0);
