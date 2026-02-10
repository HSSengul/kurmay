import { redirect } from "next/navigation";

type Props = {
  searchParams?: {
    uid?: string;
    id?: string;
  };
};

export default function SellerRedirectPage({ searchParams }: Props) {
  const uid = searchParams?.uid || searchParams?.id;
  if (uid) {
    redirect(`/seller/${uid}`);
  }
  redirect("/");
}
