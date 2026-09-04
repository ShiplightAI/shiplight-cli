import { Button, Group, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface UseLeaveGuardOptions {
  enabled: boolean;
  title?: string;
  message: React.ReactNode;
  stayLabel?: string;
  leaveLabel?: string;
  onDiscard?: () => void | Promise<void>;
  /** Return true to allow navigation without showing the guard */
  shouldIgnore?: (url: string) => boolean;
}

interface ConfirmLeaveModalContentProps {
  message: React.ReactNode;
  stayLabel: string;
  leaveLabel: string;
  dismissModal: () => void;
  onDiscard: () => Promise<void>;
}

function ConfirmLeaveModalContent({
  message,
  stayLabel,
  leaveLabel,
  dismissModal,
  onDiscard,
}: ConfirmLeaveModalContentProps) {
  const [isDiscarding, setIsDiscarding] = useState(false);

  return (
    <Stack gap="md">
      {typeof message === 'string' ? <Text size="sm">{message}</Text> : message}
      <Group justify="flex-end">
        <Button
          variant="default"
          onClick={dismissModal}
          disabled={isDiscarding}
        >
          {stayLabel}
        </Button>
        <Button
          color="red"
          loading={isDiscarding}
          onClick={async () => {
            try {
              setIsDiscarding(true);
              await onDiscard();
            } catch (error) {
              console.error('Leave guard discard failed:', error);
              setIsDiscarding(false);
            }
          }}
        >
          {leaveLabel}
        </Button>
      </Group>
    </Stack>
  );
}

export function useLeaveGuard({
  enabled,
  title = 'You have unsaved changes',
  message,
  stayLabel = 'Stay',
  leaveLabel = 'Leave',
  onDiscard,
  shouldIgnore,
}: UseLeaveGuardOptions) {
  const router = useRouter();
  const pendingNavigationRef = useRef<string | null>(null);
  const bypassGuardRef = useRef(false);
  const modalOpenRef = useRef(false);
  const titleRef = useRef(title);
  const messageRef = useRef(message);
  const stayLabelRef = useRef(stayLabel);
  const leaveLabelRef = useRef(leaveLabel);
  const onDiscardRef = useRef(onDiscard);
  const shouldIgnoreRef = useRef(shouldIgnore);

  titleRef.current = title;
  messageRef.current = message;
  stayLabelRef.current = stayLabel;
  leaveLabelRef.current = leaveLabel;
  onDiscardRef.current = onDiscard;
  shouldIgnoreRef.current = shouldIgnore;

  const continuePendingNavigation = useCallback(async () => {
    const nextUrl = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    modalOpenRef.current = false;

    if (!nextUrl) return;

    bypassGuardRef.current = true;
    try {
      await router.push(nextUrl);
    } finally {
      bypassGuardRef.current = false;
    }
  }, [router]);

  const dismissModal = useCallback(() => {
    pendingNavigationRef.current = null;
    modalOpenRef.current = false;
    modals.closeAll();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!enabled || bypassGuardRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    const handleDiscard = async () => {
      if (onDiscardRef.current) {
        await onDiscardRef.current();
      }
      modals.closeAll();
      await continuePendingNavigation();
    };

    const handleRouteChangeStart = (url: string) => {
      if (!enabled || bypassGuardRef.current || url === router.asPath) {
        return;
      }

      if (shouldIgnoreRef.current?.(url)) {
        return;
      }

      pendingNavigationRef.current = url;

      if (!modalOpenRef.current) {
        modalOpenRef.current = true;
        modals.open({
          title: titleRef.current,
          centered: true,
          closeOnClickOutside: false,
          closeOnEscape: false,
          withCloseButton: false,
          children: (
            <ConfirmLeaveModalContent
              message={messageRef.current}
              stayLabel={stayLabelRef.current}
              leaveLabel={leaveLabelRef.current}
              dismissModal={dismissModal}
              onDiscard={handleDiscard}
            />
          ),
        });
      }

      router.events.emit('routeChangeError');
      throw 'Abort route change due to unsaved changes';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    router.events.on('routeChangeStart', handleRouteChangeStart);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      router.events.off('routeChangeStart', handleRouteChangeStart);
    };
  }, [
    continuePendingNavigation,
    dismissModal,
    enabled,
    router,
  ]);
}
