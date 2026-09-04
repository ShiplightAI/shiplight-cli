import React, { useState, useEffect, useRef } from "react";
import { Text, Image } from "@mantine/core";
import { useTranslations } from "next-intl";

interface ImageDataViewerProps {
  imageData?: Blob;
  className?: string;
  alt?: string;
  placeholder?: string;
}

/**
 * A reusable component for displaying image data from Blob objects.
 * Handles blob URL creation, cleanup, and provides a placeholder when no image is available.
 */
export const ImageDataViewer: React.FC<ImageDataViewerProps> = ({
  imageData,
  className = "",
  alt,
  placeholder,
}) => {
  const tCommon = useTranslations("Common");
  const resolvedAlt = alt ?? tCommon("imageAlt");
  const resolvedPlaceholder = placeholder ?? tCommon("noImageAvailable");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const urlCache = useRef<string | null>(null);

  useEffect(() => {
    if (imageData) {
      // Create new URL for the blob
      const url = URL.createObjectURL(imageData);
      urlCache.current = url;
      setImageUrl((prev) => {
        if (prev === url) {
          return prev;
        }
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return url;
      });
    } else {
      // Clean up when no image data
      if (urlCache.current) {
        URL.revokeObjectURL(urlCache.current);
        urlCache.current = null;
      }
      setImageUrl(null);
    }
  }, [imageData]);

  useEffect(() => {
    return () => {
      if (urlCache.current) {
        URL.revokeObjectURL(urlCache.current);
        urlCache.current = null;
      }
    };
  }, []);

  if (!imageUrl) {
    return (
      <div className={`flex items-center justify-center bg-surface ${className}`}>
        <Text c="dimmed" size="sm">{resolvedPlaceholder}</Text>
      </div>
    );
  }

  return (
    <div className={className}>
      <Image
        src={imageUrl}
        alt={resolvedAlt}
        fit="contain"
        className="w-full h-full"
      />
    </div>
  );
};