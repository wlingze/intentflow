//go:build ignore

package raw

var embedded = `
int main() {
	int value = 1;
	value = value + 1;
	printf("%d", value);
	return 0;
}
`

func Demo() string { return embedded }
