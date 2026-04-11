import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBs_ZbDhmh8s5wqozOcoXX789g37lpLYjE",
  authDomain: "taiqing-building.firebaseapp.com",
  projectId: "taiqing-building",
  storageBucket: "taiqing-building.firebasestorage.app",
  messagingSenderId: "64836090659",
  appId: "1:64836090659:web:d5de0a1610b00a71a96a96"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
