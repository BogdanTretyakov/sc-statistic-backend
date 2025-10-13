export interface GithubTreeFile {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size: number;
  url: string;
}

export interface GithubTree {
  sha: string;
  url: string;
  tree: GithubTreeFile[];
  truncated: boolean;
}

export interface GithubBlobFile {
  content: string;
  encoding: string;
}
