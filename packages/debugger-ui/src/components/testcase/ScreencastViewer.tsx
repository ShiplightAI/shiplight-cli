/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

interface ScreencastViewerProps {
  websocketUrl: string;
  className?: string;
  onOpen?: () => void;
  onClose?: () => void;
}

const ScreencastViewer: React.FC<ScreencastViewerProps> = ({ websocketUrl, className = '', onOpen, onClose }) => {
  const t = useTranslations('TestCases');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const urlCache = useRef<string | null>(null);

  useEffect(() => {
    // Clean up function to close WebSocket and revoke object URLs
    const cleanup = () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // Revoke any cached object URL
      if (urlCache.current) {
        URL.revokeObjectURL(urlCache.current);
        urlCache.current = null;
      }

      setStatus('disconnected');
    };

    // Skip if the websocketUrl is empty
    if (!websocketUrl) {
      cleanup();
      return;
    }

    // Connect to WebSocket
    setStatus('connecting');
    setErrorMessage(null);

    try {
      wsRef.current = new WebSocket(websocketUrl);

      // Connection opened
      wsRef.current.addEventListener('open', () => {
        setStatus('connected');
        onOpen?.();
      });

      // Handle incoming messages (binary image data)
      wsRef.current.addEventListener('message', (event) => {
        if (event.data instanceof Blob) {
          // Convert blob to image URL
          const url = URL.createObjectURL(event.data);

          // Set the image source
          if (imgRef.current) {
            imgRef.current.src = url;
          }

          // Clean up old object URLs to prevent memory leaks
          if (urlCache.current) {
            URL.revokeObjectURL(urlCache.current);
          }

          urlCache.current = url;
        } else {
          // Handle JSON messages (like errors)
          try {
            const jsonData = JSON.parse(event.data);
            if (jsonData.error) {
              setErrorMessage(jsonData.message || 'Unknown error');
              setStatus('error');
            }
          } catch (e) {
            console.error('Received non-binary, non-JSON message:', event.data);
          }
        }
      });

      // Connection closed
      wsRef.current.addEventListener('close', () => {
        setStatus('disconnected');
        onClose?.();
      });

      // Connection error
      wsRef.current.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        setStatus('error');
        setErrorMessage('WebSocket connection error');
      });

      // Clean up when component unmounts or URL changes
      return cleanup;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('WebSocket connection error:', errorMsg);
      setStatus('error');
      setErrorMessage(errorMsg);
      return cleanup;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websocketUrl]);

  // Render different content based on connection status
  const renderContent = () => {
    switch (status) {
      case 'connecting':
        return (
          <div className="flex items-center justify-center w-full h-full">
            <div className="text-center">
              <div className="animate-pulse mb-4">
                <svg className="w-12 h-12 mx-auto text-quaternary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <p className="text-sm text-tertiary">{t('screencast.connecting')}</p>
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="flex items-center justify-center w-full h-full">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto text-red-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
              </svg>
              <p className="text-sm text-red-500">
                {errorMessage || t('screencast.failedToConnect')}
              </p>
            </div>
          </div>
        );

      case 'disconnected':
        return (
          <div className="flex items-center justify-center w-full h-full">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto text-quaternary mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
              <p className="text-sm text-tertiary">{t('screencast.disconnected')}</p>
            </div>
          </div>
        );

      case 'connected':
        return (
          <div className="flex items-center justify-center w-full h-full overflow-hidden">
            <div className="relative w-full h-full" style={{ maxWidth: '100%', maxHeight: '100%' }}>
              <img
                ref={imgRef}
                className="w-full h-full object-contain"
                alt={t('screencast.browserScreencast')}
                style={{ display: 'block' }}
                // Default transparent 1x1 pixel while waiting for real content
                src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
              />
            </div>
          </div>
        );
    }
  };

  return (
    <div className={`w-full h-full overflow-hidden bg-surface ${className}`}>
      {renderContent()}
    </div>
  );
};

export default ScreencastViewer;