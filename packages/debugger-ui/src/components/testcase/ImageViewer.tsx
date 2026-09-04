import React, { useState, useEffect } from "react";
import { Text, ThemeIcon, ActionIcon } from "@mantine/core";
import { IconPhoto, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Image } from "@mantine/core";
import { useTranslations } from "next-intl";

export interface ImageItem {
  url: string;
  label: string;
}

interface ImageViewerProps {
  images: ImageItem[];
  className?: string;
  showKeyboardHint?: boolean;
  enableKeyboardNavigation?: boolean;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  images,
  className = "",
  showKeyboardHint = false,
  enableKeyboardNavigation = false,
}) => {
  const t = useTranslations('TestCases');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const hasImages = images.length > 0;
  const hasMultipleImages = images.length > 1;

  // Image navigation functions
  const goToPreviousImage = () => {
    setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const goToNextImage = () => {
    setCurrentImageIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  // Reset image index when images change
  useEffect(() => {
    setCurrentImageIndex(0);
  }, [images]);

  if (!hasImages) {
    return (
      <div className={`flex flex-col items-center justify-center h-full p-6 ${className}`}>
        <ThemeIcon size={48} radius={24} className="mb-4 bg-surface text-secondary">
          <IconPhoto size={24} />
        </ThemeIcon>
        <Text size="lg" fw={600} c="dark" className="mb-2 text-center">
          {t('imageViewer.noImagesAvailable')}
        </Text>
        <Text c="dimmed" size="sm" className="max-w-md text-center">
          {t('imageViewer.noImagesDesc')}
        </Text>
      </div>
    );
  }

  const safeIndex = currentImageIndex < images.length ? currentImageIndex : 0;
  const currentImage = images[safeIndex];

  return (
    <div className={`flex flex-col w-full h-full bg-surface ${className}`}>
      {/* Top Control Bar */}
      <div className="flex items-center justify-between p-2 flex-shrink-0">
        {/* Left side: Navigation arrow and label */}
        <div className="flex items-center gap-2">
          {hasMultipleImages && (
            <ActionIcon
              variant="filled"
              size="sm"
              className="bg-black/80 hover:bg-black text-white shadow-lg transition-colors"
              onClick={goToPreviousImage}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
          )}
          <div className="bg-black/70 text-white px-2 py-1 rounded text-xs font-medium">
            {currentImage.label}
          </div>
        </div>

        {/* Right side: Image counter and navigation arrow */}
        <div className="flex items-center gap-2">
          <div className="bg-black/70 text-white px-2 py-1 rounded text-xs">
            {currentImageIndex + 1} / {images.length}
          </div>
          {hasMultipleImages && (
            <ActionIcon
              variant="filled"
              size="sm"
              className="bg-black/80 hover:bg-black text-white shadow-lg transition-colors"
              onClick={goToNextImage}
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          )}
        </div>
      </div>

      {/* Current Image - takes remaining space */}
      <div className="flex-1 overflow-hidden">
        <Image
          src={currentImage.url}
          alt={currentImage.label}
          fit="contain"
          className="w-full h-full"
        />
      </div>
    </div>
  );
};