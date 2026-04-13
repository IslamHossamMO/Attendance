import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import api from '../Services/api';
import { useAuth } from './AuthContext';

const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState(() => {
    try {
      const stored = localStorage.getItem('notifications');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const lastNotificationIdRef = useRef(() => {
    try {
      const stored = localStorage.getItem('lastNotificationId');
      return stored ? parseInt(stored) : 0;
    } catch {
      return 0;
    }
  });

  const { user } = useAuth();

  useEffect(() => {
    let intervalId;
    if (user?.id) {
        const fetchNotifications = () => {
            console.log(`[Notifications] Fetching for user ID: ${user.id}`);
            api.get(`/api/Notifications/for-user/${user.id}`)
            .then(resp => {
              if (Array.isArray(resp.data)) {
                // Determine the highest ID we've seen so far that is UNREAD
                const unread = resp.data.filter(n => !n.isRead);
                const maxUnreadId = unread.length > 0 ? Math.max(...unread.map(n => n.id)) : 0;

                const lastSeenId = lastNotificationIdRef.current;

                // If we see a NEW unread notification with an ID higher than lastSeenId, 
                // it's a candidate for a browser notification.
                if (maxUnreadId > lastSeenId) {
                    const newUnreads = unread.filter(n => n.id > lastSeenId);
                    newUnreads.forEach(item => {
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification("Attendance Alert", {
                                body: item.message,
                                icon: '/Logo.png',
                                badge: '/Logo.png',
                                tag: `notif-${item.id}` 
                            });
                        }
                    });
                    lastNotificationIdRef.current = maxUnreadId;
                    localStorage.setItem('lastNotificationId', maxUnreadId.toString());
                }

                setNotifications(resp.data);
              }
            })
            .catch(() => {
              // fallback handled by initial state
            });
        };

        fetchNotifications();
        // Temporarily faster polling for debugging
        intervalId = setInterval(fetchNotifications, 5000);

        if ('serviceWorker' in navigator && 'PushManager' in window) {
          navigator.serviceWorker.register('/service-worker.js').then(async reg => {
            try {
              // Wait for service worker to be ready
              await navigator.serviceWorker.ready;

              // Check if notification permission is granted
              if (Notification.permission !== 'granted') {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') return;
              }

              const pkResp = await api.get('/api/Push/public-key');
              const publicKey = pkResp?.data?.publicKey || '';
              if (!publicKey) return;

              const urlBase64ToUint8Array = (base64String) => {
                const padding = '='.repeat((4 - base64String.length % 4) % 4);
                const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
                const rawData = atob(base64);
                const outputArray = new Uint8Array(rawData.length);
                for (let i = 0; i < rawData.length; ++i) {
                  outputArray[i] = rawData.charCodeAt(i);
                }
                return outputArray;
              };

              let sub = await reg.pushManager.getSubscription();
              if (!sub) {
                sub = await reg.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: urlBase64ToUint8Array(publicKey),
                });
              }

              const subJSON = sub.toJSON();
              console.log("[Notifications] Subscription object generated:", subJSON);
              
              if (!subJSON.keys || !subJSON.keys.p256dh || !subJSON.keys.auth) {
                throw new Error("Subscription JSON is missing required keys.");
              }

              await api.post('/api/Push/subscribe', {
                userId: parseInt(user.id),
                endpoint: subJSON.endpoint,
                keys: {
                  p256dh: subJSON.keys.p256dh,
                  auth: subJSON.keys.auth
                }
              });
              console.log("[Notifications] Push subscription synced with backend successfully.");
            } catch (e) {
              console.error("[Notifications] Push subscription error:", e);
            }
          });
        }
      }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [user?.id]);

  useEffect(() => {
    try {
      localStorage.setItem('notifications', JSON.stringify(notifications));
    } catch (error) {
      console.error("Failed to save notifications to localStorage", error);
    }
  }, [notifications]);

  const addNotification = (notification) => {
    setNotifications((prevNotifications) => {
      const newNotification = {
        id: Date.now(), // Simple unique ID
        isRead: false,
        createdAt: new Date().toISOString(),
        ...notification,
      };
      // Trigger desktop notification
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Attendance Notification", {
          body: newNotification.message,
        });
      }
      return [newNotification, ...prevNotifications];
    });
  };

  const markNotificationAsRead = (id) => {
    try {
      const userRaw = localStorage.getItem('user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      if (user?.id) {
        api.post(`/api/Notifications/mark-read/${user.id}/${id}`).catch(() => {});
      }
    } catch {}
    setNotifications((prevNotifications) =>
      prevNotifications.map((notif) =>
        notif.id === id ? { ...notif, isRead: true } : notif
      )
    );
  };

  const markAllNotificationsAsRead = () => {
    try {
      const userRaw = localStorage.getItem('user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      if (user?.id) {
        const toMark = notifications.filter(n => !n.isRead).map(n => n.id);
        toMark.forEach(id => api.post(`/api/Notifications/mark-read/${user.id}/${id}`).catch(() => {}));
      }
    } catch {}
    setNotifications((prevNotifications) =>
      prevNotifications.map((notif) => ({ ...notif, isRead: true }))
    );
  };

  const unreadCount = notifications.filter((notif) => !notif.isRead).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        addNotification,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        unreadCount,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
