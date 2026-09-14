/**
 * Audio loader handling file picker, drag-and-drop, and Web Audio decoding
 */

export class AudioLoader {
  private static decodeCtx: AudioContext | null = null;

  private static getContext(): AudioContext {
    if (!this.decodeCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.decodeCtx = new AudioContextClass();
    }
    return this.decodeCtx;
  }

  public static async loadFromFile(file: File): Promise<{ buffer: AudioBuffer; filename: string }> {
    const validExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.webm'];
    const lowerName = file.name.toLowerCase();
    const isValid = validExtensions.some(ext => lowerName.endsWith(ext)) || file.type.startsWith('audio/');

    if (!isValid) {
      throw new Error(`Unsupported audio format. Supported: ${validExtensions.join(', ')}`);
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = this.getContext();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      if (audioBuffer.duration < 1.0) {
        throw new Error('Audio file too short (minimum 1 second)');
      }

      const cleanName = file.name.replace(/\.[^/.]+$/, '').trim() || 'Untitled Signal';
      return { buffer: audioBuffer, filename: cleanName };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown decoding error';
      throw new Error(`Failed to decode audio file: ${msg}`);
    }
  }

  public static setupDropZone(
    zoneElement: HTMLElement,
    onFileSelected: (file: File) => void,
    onError: (err: string) => void
  ): () => void {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      zoneElement.classList.add('dragover');
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      zoneElement.classList.remove('dragover');
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      zoneElement.classList.remove('dragover');

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        onFileSelected(file);
      } else {
        onError('No file detected in drop event');
      }
    };

    zoneElement.addEventListener('dragover', onDragOver);
    zoneElement.addEventListener('dragleave', onDragLeave);
    zoneElement.addEventListener('drop', onDrop);

    return () => {
      zoneElement.removeEventListener('dragover', onDragOver);
      zoneElement.removeEventListener('dragleave', onDragLeave);
      zoneElement.removeEventListener('drop', onDrop);
    };
  }
}
