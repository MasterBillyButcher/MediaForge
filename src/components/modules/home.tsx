'use client';

import { useState } from 'react';
import {
  Youtube, Music4, RefreshCcw, Minimize2, Scissors, Crop, Combine,
  AudioLines, Maximize2, Image as ImageIcon, Sparkles, Download, Link2,
  ClipboardPaste, ArrowRight, Film, Captions, FileAudio, Wand2, Upload, ListMusic,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToolCard, SectionHeading } from '@/components/shared/tool-card';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';

interface PopularTool {
  id: string;
  icon: typeof Youtube;
  title: string;
  desc: string;
  target: 'playlist' | 'downloader' | 'universal' | 'converter' | 'audio-converter' | 'editor' | 'audio-tools';
  tool?: string;
}

const POPULAR_TOOLS: PopularTool[] = [
  { id: 'playlist', icon: ListMusic, title: 'Playlist Downloader', desc: 'Download entire playlists — any number of videos — in MP4, MP3, FLAC and 8 more formats.', target: 'playlist' },
  { id: 'downloader', icon: Youtube, title: 'YouTube Downloader', desc: 'Recognizes YouTube URLs and handles authorized downloads & direct media.', target: 'downloader' },
  { id: 'video-to-mp3', icon: Music4, title: 'Video to MP3', desc: 'Extract audio from any video into MP3, WAV, FLAC and more.', target: 'audio-converter' },
  { id: 'mp4-converter', icon: RefreshCcw, title: 'MP4 Converter', desc: 'Convert between MP4, WebM, MOV, MKV and 10+ other formats.', target: 'converter' },
  { id: 'compressor', icon: Minimize2, title: 'Video Compressor', desc: 'Shrink file size with H.264/VP9 while keeping quality high.', target: 'converter', tool: 'compress' },
  { id: 'trimmer', icon: Scissors, title: 'Video Trimmer', desc: 'Cut exact sections with frame-accurate server-side trimming.', target: 'editor', tool: 'trim' },
  { id: 'cropper', icon: Crop, title: 'Video Cropper', desc: 'Crop to any region or use 9:16, 1:1, 4:5 social presets.', target: 'editor', tool: 'crop' },
  { id: 'merger', icon: Combine, title: 'Video Merger', desc: 'Join multiple clips into one video, normalized automatically.', target: 'audio-tools', tool: 'video-merge' },
  { id: 'audio-converter', icon: AudioLines, title: 'Audio Converter', desc: 'MP3, WAV, M4A, AAC, FLAC, OGG — full quality control.', target: 'audio-converter' },
  { id: 'resizer', icon: Maximize2, title: 'Video Resizer', desc: 'Resize to 1080p, 4K or any custom dimension.', target: 'audio-tools', tool: 'video-resize' },
  { id: 'gif-maker', icon: Sparkles, title: 'GIF Maker', desc: 'Turn video segments into optimized palette-based GIFs.', target: 'audio-tools', tool: 'gif-maker' },
];

export function HomeModule() {
  const navigate = useAppStore((s) => s.navigate);
  const [url, setUrl] = useState('');

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      toast.error('Clipboard access was denied — paste manually with Ctrl+V.');
    }
  };

  const submitUrl = () => {
    const u = url.trim();
    if (!u) {
      toast.error('Enter a media URL first, or explore the tools below.');
      return;
    }
    if (u.split(/\s+/).filter(Boolean).length > 1 || /(list=|\/sets\/|\/playlist\/|\/album\/)/i.test(u)) {
      navigate('playlist', { url: u });
      return;
    }
    const isVideoPage = /(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|instagram\.com|facebook\.com)/i.test(u);
    navigate(isVideoPage ? 'downloader' : 'universal', { url: u });
  };

  const openTool = (item: (typeof POPULAR_TOOLS)[number]) => {
    if ('tool' in item && item.tool) {
      navigate(item.target as 'editor' | 'audio-tools', { tool: item.tool });
    } else if (item.target === 'playlist') {
      navigate('playlist');
    } else {
      navigate(item.target as 'downloader' | 'converter' | 'audio-converter');
    }
  };

  return (
    <div className="w-full">
      {/* ------------------------------ HERO ------------------------------ */}
      <section className="hero-glow border-b">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-14 pb-16 sm:pt-20 sm:pb-24 text-center">
          <Badge variant="secondary" className="mb-4 gap-1.5 py-1 px-3">
            <Wand2 className="h-3.5 w-3.5 text-primary" aria-hidden />
            One website · Multiple media tools · Everything in one place
          </Badge>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
            Everything You Need for <span className="brand-gradient-text">Video &amp; Media</span>
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Download, convert, edit, compress and manage your media with one powerful online toolkit.
          </p>

          {/* URL input */}
          <div className="mt-8 max-w-2xl mx-auto">
            <div className="flex flex-col sm:flex-row gap-2 p-2 rounded-2xl border bg-card shadow-xl shadow-primary/5">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
                  placeholder="Paste a video or media URL…"
                  className="pl-9 h-11 border-0 bg-transparent focus-visible:ring-0 text-sm sm:text-base"
                  aria-label="Media URL"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={pasteFromClipboard}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                  aria-label="Paste from clipboard"
                  title="Paste from clipboard"
                >
                  <ClipboardPaste className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <Button size="lg" onClick={submitUrl} className="h-11 px-6 font-semibold">
                <Download className="h-4 w-4 mr-2" aria-hidden />
                Fetch &amp; Download
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Direct media links are downloaded for real. Platform pages are checked and honestly explained — no fake buttons.
            </p>
          </div>

          {/* Quick shortcuts */}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {[
              { label: 'Video Converter', view: 'converter' as const },
              { label: 'Video to MP3', view: 'audio-converter' as const },
              { label: 'Video Editor', view: 'editor' as const },
              { label: 'Universal Downloader', view: 'universal' as const },
              { label: 'Image Tools', view: 'image-tools' as const },
            ].map((chip) => (
              <Button
                key={chip.label}
                variant="outline"
                size="sm"
                className="rounded-full h-8"
                onClick={() => navigate(chip.view)}
              >
                {chip.label}
                <ArrowRight className="h-3 w-3 ml-1" aria-hidden />
              </Button>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------- POPULAR TOOLS -------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
        <SectionHeading
          title="Popular Tools"
          subtitle="The most-used utilities on MediaForge — all fully functional."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {POPULAR_TOOLS.map((tool) => (
            <ToolCard
              key={tool.id}
              icon={tool.icon}
              title={tool.title}
              description={tool.desc}
              onClick={() => openTool(tool)}
            />
          ))}
        </div>
      </section>

      {/* ------------------------ EDITING TOOLS --------------------------- */}
      <section className="border-y bg-card/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
          <SectionHeading
            title="Video Editing Tools"
            subtitle="A real timeline editor with preview, text, filters, audio tracks and server-quality export."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <ToolCard
              icon={Scissors}
              title="Full Video Editor"
              description="Multi-clip timeline, trim & split, text overlays, filters, background music, voice-over recording and MP4 export."
              onClick={() => navigate('editor')}
              badge="Timeline"
            />
            <ToolCard
              icon={Crop}
              title="Crop & Social Presets"
              description="16:9, 9:16 Reels/Shorts/TikTok, 1:1 square, 4:5 portrait, 4:3 and custom crop regions."
              onClick={() => navigate('editor', { tool: 'crop' })}
            />
            <ToolCard
              icon={Captions}
              title="Text & Subtitles"
              description="Animated text overlays, SRT import and sync, subtitle extraction from videos."
              onClick={() => navigate('subtitle-tools')}
            />
          </div>
        </div>
      </section>

      {/* --------------------------- ALL TOOLS ---------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
        <SectionHeading title="All Tools" subtitle="Every tool organized by category. Each one works — pick any." />
        <Tabs defaultValue="convert" className="w-full">
          <TabsList className="mb-6 h-auto flex-wrap justify-start">
            <TabsTrigger value="convert">Convert</TabsTrigger>
            <TabsTrigger value="download">Download</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="image">Image</TabsTrigger>
            <TabsTrigger value="subtitle">Subtitles</TabsTrigger>
          </TabsList>

          <TabsContent value="convert">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <ToolCard icon={Film} title="Video Converter" description="MP4, WebM, MOV, MKV, GIF — with resolution, bitrate, FPS and codec control." onClick={() => navigate('converter')} />
              <ToolCard icon={AudioLines} title="Audio Converter" description="MP3, WAV, M4A, AAC, FLAC, OGG conversions with bitrate and sample-rate control." onClick={() => navigate('audio-converter')} />
              <ToolCard icon={Minimize2} title="Video Compressor" description="Reduce file size with CRF-quality encoding and optional resolution caps." onClick={() => navigate('converter', { tool: 'compress' })} />
              <ToolCard icon={ImageIcon} title="Image Converter" description="PNG, JPEG, WebP, AVIF, TIFF with quality control." onClick={() => navigate('image-tools', { tool: 'convert' })} />
            </div>
          </TabsContent>

          <TabsContent value="download">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <ToolCard icon={Youtube} title="Video Downloader" description="URL-based video downloading with source detection and metadata preview." onClick={() => navigate('downloader')} />
              <ToolCard icon={Download} title="Universal Downloader" description="Social media, direct video/audio/image URLs — validated, streamed, real progress." onClick={() => navigate('universal')} />
              <ToolCard icon={Music4} title="Audio Extraction" description="Pull the audio track out of any video file into MP3/WAV/FLAC." onClick={() => navigate('audio-converter', { tool: 'extract' })} />
            </div>
          </TabsContent>

          <TabsContent value="edit">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <ToolCard icon={Scissors} title="Video Trimmer" description="Frame-accurate trim with live preview." onClick={() => navigate('editor', { tool: 'trim' })} />
              <ToolCard icon={Crop} title="Video Cropper" description="Manual crop selection with social presets." onClick={() => navigate('editor', { tool: 'crop' })} />
              <ToolCard icon={Combine} title="Video Merger" description="Concatenate multiple videos with normalization." onClick={() => navigate('audio-tools', { tool: 'video-merge' })} />
              <ToolCard icon={Maximize2} title="Video Resizer" description="Change resolution and aspect ratio." onClick={() => navigate('audio-tools', { tool: 'video-resize' })} />
              <ToolCard icon={RefreshCcw} title="Video Rotator" description="Rotate 90/180/270° or flip horizontally/vertically." onClick={() => navigate('audio-tools', { tool: 'video-rotate' })} />
              <ToolCard icon={Sparkles} title="GIF Maker" description="Video segments to high-quality palette GIFs." onClick={() => navigate('audio-tools', { tool: 'gif-maker' })} />
              <ToolCard icon={Wand2} title="Video Watermark" description="Text or image watermark with position and opacity control." onClick={() => navigate('audio-tools', { tool: 'video-watermark' })} />
            </div>
          </TabsContent>

          <TabsContent value="audio">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <ToolCard icon={FileAudio} title="Audio Cutter" description="Cut precise ranges from any audio file." onClick={() => navigate('audio-tools', { tool: 'audio-cut' })} />
              <ToolCard icon={Combine} title="Audio Merger" description="Join multiple audio files into one track." onClick={() => navigate('audio-tools', { tool: 'audio-merge' })} />
              <ToolCard icon={Minimize2} title="Audio Compressor" description="Loudness-normalized compression for consistent volume." onClick={() => navigate('audio-tools', { tool: 'audio-compress' })} />
              <ToolCard icon={AudioLines} title="Audio Volume & Speed" description="Amplify, reduce, or change playback speed." onClick={() => navigate('audio-tools', { tool: 'audio-volume' })} />
              <ToolCard icon={Music4} title="Audio Extractor" description="Extract the audio track from video files." onClick={() => navigate('audio-tools', { tool: 'audio-extract' })} />
            </div>
          </TabsContent>

          <TabsContent value="image">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <ToolCard icon={ImageIcon} title="Image Converter" description="Convert between PNG, JPEG, WebP, AVIF and TIFF." onClick={() => navigate('image-tools', { tool: 'convert' })} />
              <ToolCard icon={Minimize2} title="Image Compressor" description="Shrink images with live size comparison." onClick={() => navigate('image-tools', { tool: 'compress' })} />
              <ToolCard icon={Maximize2} title="Image Resizer" description="Resize with cover/contain/fill strategies." onClick={() => navigate('image-tools', { tool: 'resize' })} />
              <ToolCard icon={Crop} title="Image Cropper" description="Interactive crop with pixel-precision." onClick={() => navigate('image-tools', { tool: 'crop' })} />
              <ToolCard icon={Film} title="Thumbnail Maker" description="Grab any frame of a video as a PNG thumbnail." onClick={() => navigate('audio-tools', { tool: 'video-thumbnail' })} />
            </div>
          </TabsContent>

          <TabsContent value="subtitle">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <ToolCard icon={Captions} title="SRT Editor" description="Edit, retime and export subtitle files." onClick={() => navigate('subtitle-tools')} />
              <ToolCard icon={RefreshCcw} title="Subtitle Converter" description="Convert between SRT and WebVTT formats." onClick={() => navigate('subtitle-tools', { tool: 'convert' })} />
              <ToolCard icon={Wand2} title="Subtitle Synchronizer" description="Shift or scale all timings to fix sync." onClick={() => navigate('subtitle-tools', { tool: 'sync' })} />
              <ToolCard icon={Scissors} title="Subtitle Extractor" description="Pull embedded text subtitle tracks out of videos." onClick={() => navigate('subtitle-tools', { tool: 'extract' })} />
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {/* -------------------------- HOW IT WORKS -------------------------- */}
      <section className="border-t bg-card/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
          <SectionHeading title="How It Works" subtitle="Three steps. No account required for any tool." />
          <ol className="grid gap-6 md:grid-cols-3">
            {[
              { icon: Upload, step: '1', title: 'Upload a file or enter a supported URL', desc: 'Drag & drop any media file, or paste a direct media link. Files are probed instantly.' },
              { icon: Wand2, step: '2', title: 'Choose the required operation', desc: 'Pick a format, quality, crop or effect. Only genuinely supported options are shown.' },
              { icon: Download, step: '3', title: 'Process and download your result', desc: 'Real FFmpeg rendering with live progress. Grab your file when it is done.' },
            ].map((s) => (
              <li key={s.step} className="relative rounded-2xl border bg-card p-6">
                <span className="absolute -top-3 left-6 flex h-7 w-7 items-center justify-center rounded-full brand-gradient-bg text-white text-xs font-bold">
                  {s.step}
                </span>
                <s.icon className="h-6 w-6 text-primary mb-3 mt-1" aria-hidden />
                <h3 className="font-semibold mb-1.5">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
