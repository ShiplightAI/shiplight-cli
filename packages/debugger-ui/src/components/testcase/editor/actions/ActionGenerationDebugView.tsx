import React, { useState, useMemo } from 'react';
import { Tabs, Code } from '@mantine/core';
import { IconCode, IconMessageCircle, IconBrain, IconSparkles, IconRobot, IconBook } from '@tabler/icons-react';
import { JsonViewer } from './JsonViewer';
import { ActionGenerationDebugInfo } from 'shiplight-types';
import { useTranslations } from 'next-intl';

interface ActionGenerationDebugViewProps {
  debugInfo: ActionGenerationDebugInfo;
}

export const ActionGenerationDebugView: React.FC<ActionGenerationDebugViewProps> = ({
  debugInfo
}) => {
  const {
    systemPrompt,
    userPrompt,
    rawLlmResponse,
    reasoningContent,
    cuaDebugInfo,
    retrievedKnowledges
  } = debugInfo;

  const t = useTranslations('TestCases');
  const [activeTab, setActiveTab] = useState<string | null>('system-prompt');

  // Convert prompts to string format (handle both string and object formats)
  const formattedSystemPrompt = useMemo(() => {
    if (typeof systemPrompt === 'string') return systemPrompt;
    return JSON.stringify(systemPrompt, null, 2);
  }, [systemPrompt]);

  const userPromptData = useMemo(() => {
    if (typeof userPrompt === 'string') {
      try {
        return { type: 'json' as const, data: JSON.parse(userPrompt) };
      } catch {
        return { type: 'string' as const, data: userPrompt };
      }
    }
    return { type: 'json' as const, data: userPrompt };
  }, [userPrompt]);

  // Format JSON for better display
  const formattedResponse = useMemo(() => {
    if (typeof rawLlmResponse !== 'string') {
      return JSON.stringify(rawLlmResponse, null, 2);
    }
    try {
      return JSON.stringify(JSON.parse(rawLlmResponse), null, 2);
    } catch {
      return rawLlmResponse;
    }
  }, [rawLlmResponse]);

  const formattedreasoningContent = useMemo(() => {
    if (!reasoningContent) return '';
    if (typeof reasoningContent === 'string') return reasoningContent;
    return JSON.stringify(reasoningContent, null, 2);
  }, [reasoningContent]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Tabs value={activeTab} onChange={setActiveTab} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <Tabs.List style={{ flexShrink: 0 }}>
          <Tabs.Tab value="system-prompt" leftSection={<IconCode size={14} />}>
            {t('actionGenerationDebugView.tabSystemPrompt')}
          </Tabs.Tab>
          <Tabs.Tab value="user-prompt" leftSection={<IconMessageCircle size={14} />}>
            {t('actionGenerationDebugView.tabUserPrompt')}
          </Tabs.Tab>
          {reasoningContent && (
            <Tabs.Tab value="reasoningContent" leftSection={<IconBrain size={14} />}>
              {t('actionGenerationDebugView.tabReasoningContent')}
            </Tabs.Tab>
          )}
          <Tabs.Tab value="raw-response" leftSection={<IconSparkles size={14} />}>
            {t('actionGenerationDebugView.tabRawResponse')}
          </Tabs.Tab>
          {retrievedKnowledges && retrievedKnowledges.length > 0 && (
            <Tabs.Tab value="knowledge" leftSection={<IconBook size={14} />}>
              {t('actionGenerationDebugView.tabKnowledge', { count: retrievedKnowledges.length })}
            </Tabs.Tab>
          )}
          {cuaDebugInfo && (
            <>
              <Tabs.Tab value="cua-input" leftSection={<IconRobot size={14} />}>
                {t('actionGenerationDebugView.tabCuaInput')}
              </Tabs.Tab>
              <Tabs.Tab value="cua-response" leftSection={<IconRobot size={14} />}>
                {t('actionGenerationDebugView.tabCuaResponse')}
              </Tabs.Tab>
            </>
          )}
        </Tabs.List>

        <Tabs.Panel value="system-prompt" pt="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <Code block className="text-xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {formattedSystemPrompt}
          </Code>
        </Tabs.Panel>

        <Tabs.Panel value="user-prompt" pt="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {userPromptData.type === 'json' ? (
            <JsonViewer data={userPromptData.data} />
          ) : (
            <Code block className="text-xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {userPromptData.data}
            </Code>
          )}
        </Tabs.Panel>

        {reasoningContent && (
          <Tabs.Panel value="reasoningContent" pt="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Code block className="text-xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {formattedreasoningContent}
            </Code>
          </Tabs.Panel>
        )}

        <Tabs.Panel value="raw-response" pt="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <Code block className="text-xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {formattedResponse}
          </Code>
        </Tabs.Panel>

        {retrievedKnowledges && retrievedKnowledges.length > 0 && (
          <Tabs.Panel value="knowledge" pt="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <JsonViewer data={retrievedKnowledges} />
          </Tabs.Panel>
        )}

        {cuaDebugInfo && (
          <>
            <Tabs.Panel value="cua-input" pt="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <JsonViewer data={cuaDebugInfo.cuaInput} />
            </Tabs.Panel>

            <Tabs.Panel value="cua-response" pt="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <JsonViewer data={cuaDebugInfo.cuaRawResponse} />
            </Tabs.Panel>
          </>
        )}
      </Tabs>
    </div>
  );
};
