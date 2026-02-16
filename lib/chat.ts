import { db } from "@/lib/firebase";
import { devError, devWarn } from "@/lib/logger";
import { doc, getDoc, setDoc, updateDoc, Timestamp } from "firebase/firestore";

/* ================= TYPES ================= */

type StartConversationArgs = {
  listing: {
    id: string;
    ownerId?: string;
    sellerId?: string;
    title: string;
    price: number;
    brandName: string;
    modelName: string;
    imageUrls?: string[];
  };
  buyer: {
    uid: string;
    displayName: string;
    avatarUrl?: string;
  };
  sellerProfile: {
    id: string;
    displayName: string;
    avatarUrl?: string;
  };
};

/* ================= HELPERS ================= */

export function getConversationId(listingId: string, buyerId: string, sellerId: string) {
  return `${listingId}_${buyerId}_${sellerId}`;
}

/* ================= MAIN ================= */

export async function startConversation(args: StartConversationArgs): Promise<string> {
  try {
    const { listing, buyer, sellerProfile } = args;

    if (!listing?.id) throw new Error("listing.id eksik");
    if (!buyer?.uid) throw new Error("buyer.uid eksik");
    if (!sellerProfile?.id) throw new Error("sellerProfile.id eksik");

    const sellerId = listing.ownerId || listing.sellerId;

    if (!sellerId) {
      throw new Error("listing.ownerId / listing.sellerId eksik");
    }

    if (buyer.uid === sellerId) {
      throw new Error("Kendi ilanına mesaj gönderemezsin.");
    }

    const buyerDisplayName = (buyer.displayName || "").trim() || "User";
    const sellerDisplayName = (sellerProfile.displayName || "").trim() || "Satıcı";

    const conversationId = getConversationId(listing.id, buyer.uid, sellerId);

    const convoRef = doc(db, "conversations", conversationId);

    // ✅ Conversation varsa: "silinmiş" ise buyer tarafında tekrar görünür yap
    let existingSnap: any = null;
    try {
      existingSnap = await getDoc(convoRef);
    } catch (e: any) {
      devWarn("[chat] getDoc precheck denied (normal olabilir)", e?.code);
    }

    if (existingSnap?.exists?.()) {
      try {
        const data = existingSnap.data() as any;
        const buyerDeleted = !!data?.deletedFor?.buyer;

        if (buyerDeleted) {
          await updateDoc(convoRef, {
            "deletedFor.buyer": false,
          });
        }
      } catch (e) {
        devWarn("[chat] unhide update failed (ignore)", e);
      }

      return conversationId;
    }

    const now = Timestamp.now();

    const payload = {
      listingId: listing.id,
      buyerId: buyer.uid,
      sellerId: sellerId,
      participants: [buyer.uid, sellerId],

      createdAt: now,
      lastMessageAt: now,

      unread: {
        buyer: 0,
        seller: 0,
      },

      deletedFor: {
        buyer: false,
        seller: false,
      },

      // ✅ SOHBETİ TEMİZLEME (SOFT CLEAR / DELETE)
      clearedAt: {
        buyer: null,
        seller: null,
      },

      status: "active",

      // ✅ Okunmamış yokken inbox'ta 💬 gösteriyoruz
      totalMessages: 0,

      listingSnapshot: {
        listingId: listing.id,
        title: (listing.title || "").toString().slice(0, 200),
        price: Number(listing.price ?? 0),
        imageUrl: listing.imageUrls?.[0] || null,
        brandName: (listing.brandName || "").toString().slice(0, 120),
        modelName: (listing.modelName || "").toString().slice(0, 120),
      },

      sellerSnapshot: {
        publicProfileId: sellerProfile.id,
        displayName: sellerDisplayName.slice(0, 120),
        avatarUrl: sellerProfile.avatarUrl || "",
      },

      buyerSnapshot: {
        displayName: buyerDisplayName.slice(0, 120),
        avatarUrl: buyer.avatarUrl || "",
      },

      lastReadAt: {
        buyer: now,
        seller: now,
      },

      typing: {
        buyer: false,
        seller: false,
        updatedAt: now,
        by: buyer.uid,
      },
    };

    await setDoc(convoRef, payload);

    return conversationId;
  } catch (err) {
    devError("[chat] startConversation failed", err);
    throw err;
  }
}
