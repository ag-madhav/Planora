// firebase.js
// Complete Firebase setup for Planora — Auth + Firestore.
// Replace the `firebaseConfig` object below with your own config from
// Firebase console → Project settings → Your apps → SDK setup and configuration.

import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// ---------------------------------------------------------------------------
// 1. PASTE YOUR FIREBASE CONFIG HERE
// ---------------------------------------------------------------------------
const firebaseConfig = {
  // PASTE YOUR FIREBASE CONFIG HERE FROM FIREBASE CONSOLE
  apiKey: "AIzaSyBe8VxaDUG6ExIgfTJPK3lYPjFX-jaASfw",
  authDomain: "planora-9084f.firebaseapp.com",
  projectId: "planora-9084f",
  storageBucket: "planora-9084f.firebasestorage.app",
  messagingSenderId: "790638511100",
  appId: "1:790638511100:web:154f7a91f4db1a0fb1e879"
};

// ---------------------------------------------------------------------------
// 2. INITIALIZE
// ---------------------------------------------------------------------------
const app = initializeApp(firebaseConfig);

// Auth instance — used for all sign-in / sign-out operations.
export const auth = getAuth(app);

// Firestore instance — used to store and read user profiles + saved plans.
export const db = getFirestore(app);

// ---------------------------------------------------------------------------
// 3. AUTH HELPERS
// ---------------------------------------------------------------------------
const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err) {
    console.error("Google sign-in failed:", err);
    throw err;
  }
};

export const logout = () => signOut(auth);

// ---------------------------------------------------------------------------
// 4. FIRESTORE SETUP NOTES
// ---------------------------------------------------------------------------
// Before this works you need TWO things enabled in the Firebase console:
//
// a) Firestore Database
//    Firebase console → Build → Firestore Database → Create database.
//    Pick any region. Start in *production mode* (we set rules below).
//
// b) Security rules
//    Firebase console → Firestore Database → Rules tab. Paste this:
//
//    rules_version = '2';
//    service cloud.firestore {
//      match /databases/{database}/documents {
//        match /users/{userId} {
//          allow read, write: if request.auth != null
//                             && request.auth.uid == userId;
//        }
//      }
//    }
//
// Document structure that App.jsx reads/writes:
//
//    users/{uid}: {
//      email: string,
//      displayName: string,
//      createdAt: timestamp,
//      hasPasswordSet: boolean,      // true once user has linked a password
//      savedPlans: array<{           // one entry per saved floor plan
//        id, name, houseType, style, bedrooms, rooms, suggestion, savedAt
//      }>,
//      preferences: {                // last-used onboarding choices
//        houseType, style, bedrooms, budget
//      }
//    }