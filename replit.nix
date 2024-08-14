{ pkgs }: {
	deps = [
    pkgs.busybox
    pkgs.systemd
	  pkgs.ffmpeg.bin
    pkgs.nodejs-18_x
    pkgs.nodePackages.typescript-language-server
    pkgs.yarn
    pkgs.replitPackages.jest
	];
}