import { notFound } from 'next/navigation';
import { agentSkillDocuments, markdownResponse } from '~/lib/discovery';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(agentSkillDocuments).map((skill) => ({ skill }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ skill: string }> }) {
  const { skill: skillName } = await params;
  const skill = agentSkillDocuments[skillName as keyof typeof agentSkillDocuments];

  if (!skill) {
    notFound();
  }

  return markdownResponse(skill.content);
}
