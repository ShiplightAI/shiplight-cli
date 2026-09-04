import React, { useState } from 'react';
import { ActionIcon, Modal, Image, Text, Box } from '@mantine/core';
import { IconChevronRight, IconChevronDown, IconPhoto, IconExternalLink } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

interface JsonViewerProps {
  data: any;
  depth?: number;
}

const isBase64Image = (str: string): boolean => {
  if (typeof str !== 'string') return false;
  // Check if it's a data URL with base64 image
  return str.startsWith('data:image/') && str.includes('base64');
};

const isImageUrl = (str: string): boolean => {
  if (typeof str !== 'string') return false;
  try {
    const url = new URL(str);
    const path = url.pathname.toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(path);
  } catch {
    return false;
  }
};

const isUrl = (str: string): boolean => {
  if (typeof str !== 'string') return false;
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
};

const Base64ImagePreview: React.FC<{ src: string }> = ({ src }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const t = useTranslations('TestCases');

  return (
    <>
      <Box
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 8px',
          backgroundColor: '#f0f0f0',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
        onClick={() => setModalOpen(true)}
      >
        <IconPhoto size={16} style={{ color: '#666' }} />
        <Text size="xs" c="dimmed">
          {t('jsonViewer.base64ImageLabel')}
        </Text>
      </Box>
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('jsonViewer.previewTitle')}
        size="auto"
        styles={{
          content: {
            maxWidth: '90vw',
            maxHeight: '90vh',
          },
        }}
      >
        <Image src={src} alt={t('jsonViewer.base64ImageAlt')} fit="contain" style={{ maxHeight: '80vh' }} />
      </Modal>
    </>
  );
};

const ImageUrlPreview: React.FC<{ url: string }> = ({ url }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const t = useTranslations('TestCases');

  return (
    <>
      <Box
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <ActionIcon size="sm" variant="subtle" onClick={() => setModalOpen(true)}>
          <IconPhoto size={14} />
        </ActionIcon>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#1c7ed6',
            textDecoration: 'none',
            fontSize: '12px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
        <ActionIcon
          size="sm"
          variant="subtle"
          component="a"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternalLink size={14} />
        </ActionIcon>
      </Box>
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('jsonViewer.previewTitle')}
        size="auto"
        styles={{
          content: {
            maxWidth: '90vw',
            maxHeight: '90vh',
          },
        }}
      >
        <Image src={url} alt={t('jsonViewer.imagePreviewAlt')} fit="contain" style={{ maxHeight: '80vh' }} />
      </Modal>
    </>
  );
};

const UrlLink: React.FC<{ url: string }> = ({ url }) => {
  return (
    <Box
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: '#1c7ed6',
          textDecoration: 'none',
          fontSize: '12px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
      <ActionIcon
        size="sm"
        variant="subtle"
        component="a"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <IconExternalLink size={14} />
      </ActionIcon>
    </Box>
  );
};

const StringValue: React.FC<{ value: string }> = ({ value }) => {
  if (isBase64Image(value)) {
    return <Base64ImagePreview src={value} />;
  }

  if (isImageUrl(value)) {
    return <ImageUrlPreview url={value} />;
  }

  if (isUrl(value)) {
    return <UrlLink url={value} />;
  }

  // Handle strings with newlines
  if (value.includes('\n')) {
    return (
      <Text
        component="pre"
        size="xs"
        style={{
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
          display: 'inline',
          color: '#d14',
        }}
      >
        &quot;{value}&quot;
      </Text>
    );
  }

  return (
    <Text component="span" size="xs" style={{ color: '#d14', fontFamily: 'monospace' }}>
      &quot;{value}&quot;
    </Text>
  );
};

const JsonValue: React.FC<{ value: any; isLast: boolean }> = ({ value, isLast }) => {
  const renderValue = () => {
    if (value === null) {
      return (
        <Text component="span" size="xs" style={{ color: '#808080', fontFamily: 'monospace' }}>
          null
        </Text>
      );
    }

    if (value === undefined) {
      return (
        <Text component="span" size="xs" style={{ color: '#808080', fontFamily: 'monospace' }}>
          undefined
        </Text>
      );
    }

    if (typeof value === 'boolean') {
      return (
        <Text component="span" size="xs" style={{ color: '#0000ff', fontFamily: 'monospace' }}>
          {value.toString()}
        </Text>
      );
    }

    if (typeof value === 'number') {
      return (
        <Text component="span" size="xs" style={{ color: '#1c00cf', fontFamily: 'monospace' }}>
          {value}
        </Text>
      );
    }

    if (typeof value === 'string') {
      return <StringValue value={value} />;
    }

    return null;
  };

  return (
    <>
      {renderValue()}
      {!isLast && (
        <Text component="span" size="xs" style={{ fontFamily: 'monospace' }}>
          ,
        </Text>
      )}
    </>
  );
};

const JsonNode: React.FC<{ keyName: string | number; value: any; isLast: boolean; depth: number }> = ({
  keyName,
  value,
  isLast,
  depth,
}) => {
  const [expanded, setExpanded] = useState(depth < 4); // Auto-expand first 4 levels

  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isExpandable = isObject || isArray;

  const indent = depth * 16;

  if (!isExpandable) {
    return (
      <div style={{ marginLeft: `${indent}px`, fontFamily: 'monospace', fontSize: '12px' }}>
        <Text component="span" size="xs" style={{ color: '#881391', fontFamily: 'monospace' }}>
          {typeof keyName === 'string' ? `"${keyName}"` : keyName}
        </Text>
        <Text component="span" size="xs" style={{ fontFamily: 'monospace' }}>
          :{' '}
        </Text>
        <JsonValue value={value} isLast={isLast} />
      </div>
    );
  }

  const entries = isArray ? value : Object.entries(value);
  const preview = isArray
    ? `Array(${value.length})`
    : `Object{${Object.keys(value).length}}`;

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
      <div
        style={{
          marginLeft: `${indent}px`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <Text component="span" size="xs" style={{ color: '#881391', fontFamily: 'monospace' }}>
          {typeof keyName === 'string' ? `"${keyName}"` : keyName}
        </Text>
        <Text component="span" size="xs" style={{ fontFamily: 'monospace' }}>
          :{' '}
        </Text>
        {!expanded && (
          <Text component="span" size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
            {preview}
          </Text>
        )}
        {!expanded && !isLast && (
          <Text component="span" size="xs" style={{ fontFamily: 'monospace' }}>
            ,
          </Text>
        )}
      </div>

      {expanded && (
        <>
          <div style={{ marginLeft: `${indent}px`, fontFamily: 'monospace' }}>
            <Text component="span" size="xs">
              {isArray ? '[' : '{'}
            </Text>
          </div>
          {isArray
            ? value.map((item: any, index: number) => (
                <JsonNode
                  key={index}
                  keyName={index}
                  value={item}
                  isLast={index === value.length - 1}
                  depth={depth + 1}
                />
              ))
            : Object.entries(value).map(([key, val], index) => (
                <JsonNode
                  key={key}
                  keyName={key}
                  value={val}
                  isLast={index === Object.keys(value).length - 1}
                  depth={depth + 1}
                />
              ))}
          <div style={{ marginLeft: `${indent}px`, fontFamily: 'monospace' }}>
            <Text component="span" size="xs">
              {isArray ? ']' : '}'}
            </Text>
            {!isLast && (
              <Text component="span" size="xs">
                ,
              </Text>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const JsonViewer: React.FC<JsonViewerProps> = ({ data, depth = 0 }) => {
  // Handle primitives at the root level
  if (data === null || data === undefined || typeof data !== 'object') {
    return (
      <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
        <JsonValue value={data} isLast={true} />
      </div>
    );
  }

  const isArray = Array.isArray(data);

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', padding: '8px' }}>
      {isArray ? (
        <>
          <div>
            <Text component="span" size="xs">
              [
            </Text>
          </div>
          {data.map((item: any, index: number) => (
            <JsonNode
              key={index}
              keyName={index}
              value={item}
              isLast={index === data.length - 1}
              depth={1}
            />
          ))}
          <div>
            <Text component="span" size="xs">
              ]
            </Text>
          </div>
        </>
      ) : (
        <>
          <div>
            <Text component="span" size="xs">
              {'{'}
            </Text>
          </div>
          {Object.entries(data).map(([key, value], index) => (
            <JsonNode
              key={key}
              keyName={key}
              value={value}
              isLast={index === Object.keys(data).length - 1}
              depth={1}
            />
          ))}
          <div>
            <Text component="span" size="xs">
              {'}'}
            </Text>
          </div>
        </>
      )}
    </div>
  );
};
