import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  // PASTE YOUR FIREBASE CONFIG HERE FROM FIREBASE CONSOLE
  apiKey: "AIzaSyBe8VxaDUG6ExIgfTJPK3lYPjFX-jaASfw",
  authDomain: "planora-9084f.firebaseapp.com",
  projectId: "planora-9084f",
  storageBucket: "planora-9084f.firebasestorage.app",
  messagingSenderId: "790638511100",
  appId: "1:790638511100:web:154f7a91f4db1a0fb1e879"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const signInWithGoogle = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);