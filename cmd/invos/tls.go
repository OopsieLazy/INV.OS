package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

/* HTTPS for a shop LAN.

   There is no certificate authority that will vouch for "the box on the bench at
   192.168.1.40", so a public certificate is not available at any price. The honest option
   is a self-signed one the station generates for itself and keeps: the browser warns once
   per device, someone accepts it, and from then on the traffic is encrypted.

   Why bother, when the shop's own wifi is nominally trusted: without it, every quantity,
   every part number and — if one is set — the API token cross the air in plain text, and
   anything already on that network can read them or modify a reply in flight. Encryption
   is what stops the station being a soft target for something that is already inside.

   Localhost does not need this and does not get it by default. This is for -lan.
*/

const certLifetime = 10 * 365 * 24 * time.Hour // it is a shop box, not a public site

// ensureCert returns paths to a certificate and key next to the database, generating them
// on first use. Regenerated when the certificate is within thirty days of expiry or when
// the station has gained an address the certificate does not cover — a box whose DHCP
// lease moved should not start failing to identify itself.
func ensureCert(dir string, hosts []string) (certPath, keyPath string, err error) {
	certPath = filepath.Join(dir, "invos-cert.pem")
	keyPath = filepath.Join(dir, "invos-key.pem")

	if ok, why := certUsable(certPath, hosts); ok {
		return certPath, keyPath, nil
	} else if why != "" {
		fmt.Println("  tls       regenerating certificate: " + why)
	}
	if err := generateCert(certPath, keyPath, hosts); err != nil {
		return "", "", err
	}
	return certPath, keyPath, nil
}

func certUsable(path string, hosts []string) (bool, string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false, "" // no certificate yet; not worth announcing
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return false, "the existing one is unreadable"
	}
	c, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false, "the existing one is unreadable"
	}
	if time.Now().Add(30 * 24 * time.Hour).After(c.NotAfter) {
		return false, "the existing one is about to expire"
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			if !containsIP(c.IPAddresses, ip) {
				return false, "this station has a new address (" + h + ")"
			}
			continue
		}
		if !containsName(c.DNSNames, h) {
			return false, "this station has a new name (" + h + ")"
		}
	}
	return true, ""
}

func containsIP(list []net.IP, ip net.IP) bool {
	for _, x := range list {
		if x.Equal(ip) {
			return true
		}
	}
	return false
}

func containsName(list []string, n string) bool {
	for _, x := range list {
		if x == n {
			return true
		}
	}
	return false
}

func generateCert(certPath, keyPath string, hosts []string) error {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}

	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{Organization: []string{"INV.OS"}, CommonName: "INV.OS station"},
		NotBefore:             time.Now().Add(-time.Hour), // tolerate a station whose clock is behind
		NotAfter:              time.Now().Add(certLifetime),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			tmpl.IPAddresses = append(tmpl.IPAddresses, ip)
		} else {
			tmpl.DNSNames = append(tmpl.DNSNames, h)
		}
	}

	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return err
	}
	if err := writePEM(certPath, "CERTIFICATE", der, 0o644); err != nil {
		return err
	}
	kder, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return err
	}
	// 0600: the private key is the one file here that genuinely must not be readable by
	// anyone else on the box.
	return writePEM(keyPath, "EC PRIVATE KEY", kder, 0o600)
}

func writePEM(path, kind string, der []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := pem.Encode(f, &pem.Block{Type: kind, Bytes: der}); err != nil {
		return err
	}
	return f.Chmod(mode)
}

// certHosts is every name and address this station can legitimately be reached by, so one
// certificate covers localhost and the LAN addresses the app prints.
func certHosts(lanIPs []string) []string {
	hosts := []string{"localhost", "127.0.0.1", "::1"}
	if h, err := os.Hostname(); err == nil && h != "" {
		hosts = append(hosts, h, h+".local")
	}
	seen := map[string]bool{}
	out := hosts[:0]
	for _, h := range append(hosts, lanIPs...) {
		if h != "" && !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
	}
	return out
}
