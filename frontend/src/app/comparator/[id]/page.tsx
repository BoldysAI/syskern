import { ComparisonDetailPage } from "./ComparisonDetailClient";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ComparisonPage({ params }: Props) {
  const { id } = await params;
  return <ComparisonDetailPage id={id} />;
}
