importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// حط نفس بيانات مشروعك هنا
const firebaseConfig = {
    apiKey: "AIzaSyDpvqNAReChsHn5tFJSp7vV_EJHmtD2x4c",
    authDomain: "pools-e4381.firebaseapp.com",
    projectId: "pools-e4381",
    storageBucket: "pools-e4381.appspot.com",
    messagingSenderId: "339799216046",
    appId: "1:339799216046:web:26e437a7b7d5c24fe9023f"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// الكود ده اللي بيستلم الإشعار ويظهره والتطبيق في الخلفية
messaging.onBackgroundMessage(function(payload) {
  console.log('تم استلام إشعار في الخلفية ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: payload.notification.icon || '/icon.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
