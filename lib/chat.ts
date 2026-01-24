import { db } from "@/lib/firebase";
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
  console.log("🟢 [1] startConversation ENTER");

  try {
    console.log("🟢 [2] args =", args);

    const { listing, buyer, sellerProfile } = args;

    console.log("🟢 [3] extracted listing/buyer/sellerProfile");

    if (!listing?.id) throw new Error("listing.id eksik");
    if (!buyer?.uid) throw new Error("buyer.uid eksik");
    if (!sellerProfile?.id) throw new Error("sellerProfile.id eksik");

    console.log("🟢 [4] basic args validated");

    const sellerId = listing.ownerId || listing.sellerId;
    console.log("🟢 [5] sellerId =", sellerId);

    if (!sellerId) {
      throw new Error("listing.ownerId / listing.sellerId eksik");
    }

    if (buyer.uid === sellerId) {
      throw new Error("Kendi ilanına mesaj gönderemezsin.");
    }

    console.log("🟢 [6] buyer != seller");

    const buyerDisplayName = (buyer.displayName || "").trim() || "User";
    const sellerDisplayName = (sellerProfile.displayName || "").trim() || "Satıcı";

    console.log("🟢 [7] displayNames", {
      buyerDisplayName,
      sellerDisplayName,
    });

    const conversationId = getConversationId(listing.id, buyer.uid, sellerId);

    console.log("🟢 [8] conversationId =", conversationId);

    const convoRef = doc(db, "conversations", conversationId);
    console.log("🟢 [9] convoRef created");

    // ✅ Conversation varsa: "silinmiş" ise buyer tarafında tekrar görünür yap
    let existingSnap: any = null;
    try {
      existingSnap = await getDoc(convoRef);
    } catch (e: any) {
      console.warn("🟡 getDoc precheck denied (normal olabilir). Devam ediyorum...", e?.code);
    }

    if (existingSnap?.exists?.()) {
      console.log("🟡 [EXISTS] conversation already exists → unhide for buyer and return id");

      try {
        const data = existingSnap.data() as any;
        const buyerDeleted = !!data?.deletedFor?.buyer;

        if (buyerDeleted) {
          await updateDoc(convoRef, {
            "deletedFor.buyer": false,
          });
          console.log("🟢 [EXISTS] deletedFor.buyer reset → false");
        }
      } catch (e) {
        console.warn("🟡 [EXISTS] unhide update failed (ignore)", e);
      }

      return conversationId;
    }

    console.log("🟢 [10] preparing timestamps...");
    const now = Timestamp.now();
    console.log("🟢 [11] Timestamp.now() =", now);

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

    console.log("🟢 [12] payload built", payload);

    console.log("🟢 [13] calling setDoc(conversations/{id})...");
    await setDoc(convoRef, payload);

    console.log("🟢 [15] setDoc SUCCESS");

    return conversationId;
  } catch (err) {
    console.error("🔴 [ERROR] startConversation failed", err);
    throw err;
  }
}
