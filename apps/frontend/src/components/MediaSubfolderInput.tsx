'use client';

import { useState } from 'react';
import { relativeMediaFolder } from './MediaLocationSummary';
import { PathInput } from './PathPicker';

export function resolveMediaSubfolder(root: string, input: string): string | null {
  if (!root.startsWith('/') || root === '/' || root.split('/').includes('..')) return null;
  const parts = input.split('/');
  if (
    !input.trim() ||
    input.startsWith('/') ||
    parts.some((part) => !part || part === '.' || part === '..' || !part.trim())
  )
    return null;
  return `${root.replace(/\/+$/, '')}/${input}`;
}

export function rebaseMediaSubfolder(oldRoot: string, newRoot: string, folder: string): string {
  const relative = relativeMediaFolder(oldRoot, folder);
  return relative && relative !== '.' ? (resolveMediaSubfolder(newRoot, relative) ?? folder) : folder;
}

export function MediaSubfolderInput({
  label,
  root,
  value,
  defaultFolder,
  onChange
}: {
  label: string;
  root: string;
  value: string;
  defaultFolder: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [outsideOverride, setOutsideOverride] = useState(false);
  const relative = relativeMediaFolder(root, value);
  const outside = relative === null || relative === '.' || outsideOverride;
  const shown = draft ?? (relative && relative !== '.' ? relative : defaultFolder);
  const invalid = draft !== null && resolveMediaSubfolder(root, draft) === null;

  return (
    <div>
      {outside ? (
        <details open={relative === null || relative === '.' ? true : undefined}>
          <summary>Advanced: {label} outside Media</summary>
          <p>
            This folder is independent of Media. Different filesystems require copying imports instead of hardlinking.
          </p>
          <label>
            {label} folder on host
            <PathInput value={value} onChange={onChange} />
          </label>
          <button
            type="button"
            disabled={!resolveMediaSubfolder(root, defaultFolder)}
            onClick={() => {
              const next = resolveMediaSubfolder(root, defaultFolder);
              if (next) {
                setOutsideOverride(false);
                setDraft(null);
                onChange(next);
              }
            }}
          >
            Use {defaultFolder} inside Media
          </button>
        </details>
      ) : (
        <>
          <label>
            {label} subfolder inside Media
            <input
              aria-invalid={invalid}
              value={shown}
              onChange={(event) => {
                const nextDraft = event.target.value;
                setDraft(nextDraft);
                const next = resolveMediaSubfolder(root, nextDraft);
                if (next) onChange(next);
              }}
            />
          </label>
          {invalid && <small role="alert">Enter a non-empty relative folder without . or .. segments.</small>}
          <details>
            <summary>Advanced: {label} outside Media</summary>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setOutsideOverride(true);
              }}
            >
              Choose a separate host folder
            </button>
          </details>
        </>
      )}
    </div>
  );
}
