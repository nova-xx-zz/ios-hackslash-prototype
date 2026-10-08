// js/vendor/firebase.js の元。ゲームで使う Firebase の機能だけをまとめ、1つのファイル（window.QPFirebase）にする。
// 作り直し: npm run build:firebase（firebase のバージョンを上げた時など）
// 外部のCDNから読み込まないのは、オフラインやアプリ（Capacitor）でも同じファイルで動かすため
export { initializeApp } from "firebase/app";
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  onAuthStateChanged, signInAnonymously, signInWithPopup, linkWithPopup, GoogleAuthProvider, signOut, getIdToken, browserPopupRedirectResolver,
} from "firebase/auth";
export { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore/lite";
export { initializeAppCheck, ReCaptchaV3Provider, getToken } from "firebase/app-check";
